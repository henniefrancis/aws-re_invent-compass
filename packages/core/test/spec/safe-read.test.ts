import { mkdir, mkdtemp, link, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createNodeSpecFs, SPEC_READ_LIMIT } from '../../src/spec/node-spec-fs.js';
import type { FileInfo, OpenedFile, ReadDeps } from '../../src/spec/node-spec-fs.js';
import { SpecWriteRefusedError } from '../../src/spec/spec-errors.js';
import { addWeekSpecToGitignore, isWeekSpecIgnored } from '../../src/spec/gitignore-entry.js';
import { weekSpecDirectory, writeWeekSpec } from '../../src/spec/write.js';

let root: string;
let directory: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'compass-saferead-'));
  directory = weekSpecDirectory(root);
  await mkdir(directory, { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const files = { requirementsMd: 'R', designMd: 'D', tasksMd: 'T' };

describe('reading an existing spec document or .gitignore (security review H2)', () => {
  test('reads a regular file and refuses a name outside the allowed set', async () => {
    const fs = createNodeSpecFs();
    await writeFile(join(directory, 'tasks.md'), 'hello');
    expect(await fs.readText(join(directory, 'tasks.md'))).toBe('hello');
    await writeFile(join(root, 'notes.txt'), 'x');
    await expect(fs.readText(join(root, 'notes.txt'))).rejects.toBeInstanceOf(
      SpecWriteRefusedError,
    );
    await expect(fs.readText(join(root, '..', 'etc', 'passwd'))).rejects.toBeInstanceOf(
      SpecWriteRefusedError,
    );
  });

  test('refuses a missing file, a folder, an oversize file and a file with a second hard link', async () => {
    const fs = createNodeSpecFs();
    await expect(fs.readText(join(directory, 'design.md'))).rejects.toBeInstanceOf(
      SpecWriteRefusedError,
    );
    await mkdir(join(root, '.gitignore'));
    await expect(fs.readText(join(root, '.gitignore'))).rejects.toBeInstanceOf(
      SpecWriteRefusedError,
    );
    await writeFile(join(directory, 'requirements.md'), 'x'.repeat(SPEC_READ_LIMIT + 1));
    await expect(fs.readText(join(directory, 'requirements.md'))).rejects.toBeInstanceOf(
      SpecWriteRefusedError,
    );
    await writeFile(join(directory, 'tasks.md'), 'secret outside the spec');
    await link(join(directory, 'tasks.md'), join(root, '.gitignore-copy'));
    await expect(fs.readText(join(directory, 'tasks.md'))).rejects.toBeInstanceOf(
      SpecWriteRefusedError,
    );
  });

  test('refuses a symbolic link (skipped where links cannot be created)', async () => {
    const secret = join(root, 'secret.txt');
    await writeFile(secret, 'private data');
    try {
      await symlink(secret, join(root, '.gitignore'));
    } catch {
      return;
    }
    await expect(createNodeSpecFs().readText(join(root, '.gitignore'))).rejects.toBeInstanceOf(
      SpecWriteRefusedError,
    );
  });

  const plain: FileInfo = {
    isSymbolicLink: () => false,
    isFile: () => true,
    nlink: 1,
    size: 5,
    ino: 7,
    dev: 3,
  };
  const opened = (over: Partial<FileInfo> = {}, read?: OpenedFile['read']) => {
    const state = { closed: 0 };
    const handle: OpenedFile = {
      stat: () => Promise.resolve({ ...plain, ...over }),
      read:
        read ??
        ((buffer) => {
          buffer.write('hello');
          return Promise.resolve({ bytesRead: 5 });
        }),
      close: () => {
        state.closed += 1;
        return Promise.resolve();
      },
    };
    return { handle, state };
  };
  const deps = (stat: FileInfo, handle: () => Promise<OpenedFile>): ReadDeps => ({
    stat: () => Promise.resolve(stat),
    open: handle,
  });
  const path = (): string => join(directory, 'design.md');

  test('refuses what the first look reports as a link, a non-file, a second name or a big file', async () => {
    for (const over of [
      { isSymbolicLink: () => true },
      { isFile: () => false },
      { nlink: 2 },
      { size: SPEC_READ_LIMIT + 1 },
    ]) {
      const { handle } = opened();
      const fs = createNodeSpecFs(
        undefined,
        deps({ ...plain, ...over }, () => Promise.resolve(handle)),
      );
      await expect(fs.readText(path())).rejects.toBeInstanceOf(SpecWriteRefusedError);
    }
  });

  test('refuses when the open fails, and checks the file again through the open handle', async () => {
    const failing = createNodeSpecFs(
      undefined,
      deps(plain, () => Promise.reject(new Error('ELOOP'))),
    );
    await expect(failing.readText(path())).rejects.toBeInstanceOf(SpecWriteRefusedError);
    const failingStat = createNodeSpecFs(undefined, {
      stat: () => Promise.reject(new Error('EACCES')),
      open: () => Promise.reject(new Error('unused')),
    });
    await expect(failingStat.readText(path())).rejects.toBeInstanceOf(SpecWriteRefusedError);

    for (const over of [
      { isFile: () => false },
      { isSymbolicLink: () => true },
      { nlink: 2 },
      { size: SPEC_READ_LIMIT + 1 },
      { ino: 8 },
      { dev: 4 },
    ]) {
      const { handle, state } = opened(over);
      const fs = createNodeSpecFs(
        undefined,
        deps(plain, () => Promise.resolve(handle)),
      );
      await expect(fs.readText(path())).rejects.toBeInstanceOf(SpecWriteRefusedError);
      expect(state.closed).toBe(1);
    }
  });

  test('a read that fails after the open is a refusal and the handle is closed', async () => {
    const { handle, state } = opened({}, () => Promise.reject(new Error('EIO')));
    const fs = createNodeSpecFs(
      undefined,
      deps(plain, () => Promise.resolve(handle)),
    );
    await expect(fs.readText(path())).rejects.toBeInstanceOf(SpecWriteRefusedError);
    expect(state.closed).toBe(1);
    const good = opened();
    const ok = createNodeSpecFs(
      undefined,
      deps(plain, () => Promise.resolve(good.handle)),
    );
    expect(await ok.readText(path())).toBe('hello');
    expect(good.state.closed).toBe(1);
  });
});

describe('the writer and the gitignore offer refuse before they diff or write', () => {
  const linkedDocument = (fs = createNodeSpecFs()) => fs;

  test('a re-run with a document that is not a plain file writes nothing and returns no diff', async () => {
    await writeFile(join(directory, 'requirements.md'), 'old');
    await writeFile(join(directory, 'design.md'), 'old');
    await writeFile(join(directory, 'tasks.md'), 'old');
    await link(join(directory, 'design.md'), join(root, 'second-name'));
    const before = await readFile(join(directory, 'design.md'), 'utf8');
    await expect(
      writeWeekSpec(root, files, { fs: linkedDocument(), today: '2026-11-30' }),
    ).rejects.toBeInstanceOf(SpecWriteRefusedError);
    expect(await readFile(join(directory, 'design.md'), 'utf8')).toBe(before);
    const { readdir } = await import('node:fs/promises');
    expect((await readdir(directory)).sort()).toEqual(['design.md', 'requirements.md', 'tasks.md']);
  });

  test('a .gitignore with a second hard link is neither read for the offer nor appended to', async () => {
    await writeFile(join(root, 'elsewhere'), 'node_modules\n');
    await link(join(root, 'elsewhere'), join(root, '.gitignore'));
    const fs = createNodeSpecFs();
    await expect(isWeekSpecIgnored(root, fs)).rejects.toBeInstanceOf(SpecWriteRefusedError);
    await expect(addWeekSpecToGitignore(root, fs)).rejects.toBeInstanceOf(SpecWriteRefusedError);
    expect(await readFile(join(root, 'elsewhere'), 'utf8')).toBe('node_modules\n');
  });
});
