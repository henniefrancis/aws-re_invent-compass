import { DASH_PATTERN } from '../support/dashes.js';
import { describe, expect, test } from 'vitest';
import { isSupportedFile } from '../../src/scanner/file-filter.js';
import { DEFAULT_TECH_DETECTORS } from '../../src/scanner/scan-repo.js';
import {
  TECH_TABLE,
  normalisePypi,
  resolveTech,
  techEntryFor,
  techForExtension,
  techForManifest,
  techForPackage,
} from '../../src/scanner/tech-table.js';
import type { PackageEcosystem } from '../../src/scanner/tech-table.js';

const ECOSYSTEMS: readonly PackageEcosystem[] = ['npm', 'pypi', 'nuget', 'maven', 'gems'];

/** A concrete file name for a manifest pattern (`*.csproj` becomes `App.csproj`). */
const concrete = (manifest: string): string =>
  manifest.startsWith('*') ? `App${manifest.slice(1)}` : manifest;

describe('TECH_TABLE structure', () => {
  test('entries are sorted by key, keys are unique and every entry has a signal and search words', () => {
    const keys = TECH_TABLE.map((entry) => entry.key);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of TECH_TABLE) {
      expect(entry.displayName.length).toBeGreaterThan(0);
      expect(['language', 'framework', 'platform', 'tool']).toContain(entry.group);
      expect(entry.searchWords.length).toBeGreaterThan(0);
      const signals =
        entry.extensions.length +
        entry.manifestNames.length +
        ECOSYSTEMS.reduce((sum, ecosystem) => sum + entry[ecosystem].length, 0);
      expect(signals).toBeGreaterThan(0);
    }
  });

  test('holds at least the technologies the owner named', () => {
    for (const key of [
      'dotnet',
      'csharp',
      'fsharp',
      'aspnet',
      'nodejs',
      'javascript',
      'typescript',
      'python',
      'java',
      'kotlin',
      'go',
      'rust',
      'ruby',
      'rails',
      'php',
      'swift',
      'react',
      'angular',
      'vue',
      'nextjs',
      'nestjs',
      'express',
      'django',
      'flask',
      'fastapi',
      'spring',
      'pytorch',
      'tensorflow',
      'langchain',
      'graphql',
      'docker',
      'kubernetes',
      'terraform',
    ]) {
      expect(techEntryFor(key)?.key).toBe(key);
    }
    expect(techEntryFor('nothing')).toBeUndefined();
  });

  test('names, search words and aliases hold no dash character, aliases are lower case', () => {
    for (const entry of TECH_TABLE) {
      for (const text of [entry.displayName, ...entry.searchWords, ...entry.aliases]) {
        expect(text).not.toMatch(DASH_PATTERN);
      }
      for (const alias of entry.aliases) {
        expect(alias).toBe(alias.toLowerCase());
      }
    }
  });

  test('Go is never searched as the bare word "Go"', () => {
    expect(techEntryFor('go')?.searchWords).toEqual(['Golang', 'Go language']);
    for (const entry of TECH_TABLE) {
      expect(entry.searchWords.map((word) => word.toLowerCase())).not.toContain('go');
    }
  });

  test('every key, display name and alias resolves to its own entry and never to another', () => {
    const seen = new Map<string, string>();
    for (const entry of TECH_TABLE) {
      for (const name of [entry.key, entry.displayName, ...entry.aliases]) {
        const id = name.toLowerCase();
        expect(seen.get(id) ?? entry.key).toBe(entry.key);
        seen.set(id, entry.key);
        expect(resolveTech(name)?.key).toBe(entry.key);
      }
    }
  });

  test('every extension, manifest name and package name belongs to one entry and resolves to it', () => {
    const seen = new Set<string>();
    const once = (id: string): void => {
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    };
    for (const entry of TECH_TABLE) {
      for (const extension of entry.extensions) {
        once(`ext:${extension}`);
        expect(extension).toBe(extension.toLowerCase());
        expect(techForExtension(`file${extension}`)).toBe(entry.key);
      }
      for (const manifest of entry.manifestNames) {
        once(`manifest:${manifest}`);
        expect(techForManifest(concrete(manifest))).toBe(entry.key);
      }
      for (const ecosystem of ECOSYSTEMS) {
        for (const name of entry[ecosystem]) {
          once(`${ecosystem}:${name.toLowerCase()}`);
          const sample = name.endsWith('*') ? `${name.slice(0, -1)}sample` : name;
          expect(techForPackage(ecosystem, sample)).toBe(entry.key);
        }
      }
    }
  });

  test('every manifest name is read by the walker and accepted by exactly one default Tech_Detector', () => {
    for (const entry of TECH_TABLE) {
      for (const manifest of entry.manifestNames) {
        const name = concrete(manifest);
        expect(isSupportedFile(name)).toBe(true);
        expect(DEFAULT_TECH_DETECTORS.filter((d) => d.accepts(name))).toHaveLength(1);
      }
    }
  });
});

describe('resolveTech', () => {
  test('resolves common spellings in any case, trimmed', () => {
    expect(resolveTech('.NET')?.key).toBe('dotnet');
    expect(resolveTech(' dotnet ')?.key).toBe('dotnet');
    expect(resolveTech('net core')?.key).toBe('dotnet');
    expect(resolveTech('C#')?.key).toBe('csharp');
    expect(resolveTech('csharp')?.key).toBe('csharp');
    expect(resolveTech('Golang')?.key).toBe('go');
    expect(resolveTech('NODE.JS')?.key).toBe('nodejs');
    expect(resolveTech('k8s')?.key).toBe('kubernetes');
    expect(resolveTech('Spring')?.displayName).toBe('Spring Boot');
  });

  test('an unknown or empty name resolves to nothing', () => {
    expect(resolveTech('COBOL')).toBeUndefined();
    expect(resolveTech('   ')).toBeUndefined();
  });
});

describe('signal lookups', () => {
  test('extensions are compared in lower case and a leading dot is not an extension', () => {
    expect(techForExtension('Program.CS')).toBe('csharp');
    expect(techForExtension('index.d.ts')).toBe('typescript');
    expect(techForExtension('build.gradle.kts')).toBe('kotlin');
    expect(techForExtension('.ts')).toBeUndefined();
    expect(techForExtension('Makefile')).toBeUndefined();
    expect(techForExtension('App.csproj')).toBeUndefined();
    expect(techForExtension('notes.md')).toBeUndefined();
  });

  test('manifest names match exactly or by a starred suffix', () => {
    expect(techForManifest('package.json')).toBe('nodejs');
    expect(techForManifest('Api.Tests.csproj')).toBe('dotnet');
    expect(techForManifest('All.sln')).toBe('dotnet');
    expect(techForManifest('Dockerfile')).toBe('docker');
    expect(techForManifest('dockerfile')).toBeUndefined();
    expect(techForManifest('other.json')).toBeUndefined();
  });

  test('packages match exactly or by a starred prefix, NuGet without case and PyPI normalised', () => {
    expect(techForPackage('npm', '@langchain/core')).toBe('langchain');
    expect(techForPackage('npm', 'react')).toBe('react');
    expect(techForPackage('npm', 'React')).toBeUndefined();
    expect(techForPackage('nuget', 'microsoft.aspnetcore.openapi')).toBe('aspnet');
    expect(techForPackage('nuget', 'MICROSOFT.ASPNETCORE.MVC')).toBe('aspnet');
    expect(techForPackage('pypi', 'Django')).toBe('django');
    expect(techForPackage('pypi', 'LangChain_Community')).toBe('langchain');
    expect(techForPackage('maven', 'spring-boot-starter-web')).toBe('spring');
    expect(techForPackage('gems', 'rails')).toBe('rails');
    expect(techForPackage('gems', 'sinatra')).toBeUndefined();
  });

  test('normalisePypi follows PEP 503', () => {
    expect(normalisePypi('Foo.Bar__baz-_qux')).toBe('foo-bar-baz-qux');
  });
});
