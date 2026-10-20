import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import {
  dotnetTechDetector,
  jvmTechDetector,
  nodeTechDetector,
  presenceTechDetector,
  pythonTechDetector,
  rubyTechDetector,
} from '../../src/scanner/detectors/tech.js';
import type { TechDetector, TechHit } from '../../src/scanner/detectors/types.js';
import {
  elementTexts,
  packageReferences,
  stripXmlComments,
} from '../../src/scanner/detectors/xml.js';
import { DEFAULT_TECH_DETECTORS } from '../../src/scanner/scan-repo.js';

/** The hits as a sorted `tech:count` list, easy to compare. */
function counts(hits: TechHit[]): string[] {
  for (const hit of hits) {
    expect(hit.kind).toBe('declarations');
  }
  return hits.map((hit) => `${hit.tech}:${hit.count}`).sort();
}

const run = (detector: TechDetector, text: string, fileName: string): string[] => {
  expect(detector.accepts(fileName)).toBe(true);
  return counts(detector.detect(text, fileName));
};

describe('node Tech_Detector (package.json)', () => {
  test('counts the manifest and the known packages of dependencies and devDependencies', () => {
    const text = JSON.stringify({
      dependencies: { react: '18', '@angular/core': '17', next: '14', lodash: '4' },
      devDependencies: { typescript: '5', '@langchain/core': '1', '@langchain/openai': '1' },
      peerDependencies: { vue: '3' },
    });
    expect(run(nodeTechDetector, text, 'package.json')).toEqual([
      'angular:1',
      'langchain:2',
      'nextjs:1',
      'nodejs:1',
      'react:1',
      'typescript:1',
    ]);
  });

  test('a manifest with no dependency sections still counts Node.js', () => {
    const text = '{"name":"x","dependencies":"oops","devDependencies":null}';
    expect(run(nodeTechDetector, text, 'package.json')).toEqual(['nodejs:1']);
  });

  test('malformed input or JSON that is not an object counts nothing', () => {
    for (const text of ['{', '', 'null', '[1]', '"text"', '42']) {
      expect(nodeTechDetector.detect(text, 'package.json')).toEqual([]);
    }
    expect(nodeTechDetector.accepts('package-lock.json')).toBe(false);
  });
});

describe('python Tech_Detector', () => {
  test('requirements.txt: one name per line, comments and options skipped, names normalised', () => {
    const text = [
      '# web',
      'Django>=5.0',
      'flask[async] == 3.0',
      '-r other.txt',
      '--index-url https://example.invalid',
      '',
      'langchain_community',
      'torch',
      'requests',
    ].join('\r\n');
    expect(run(pythonTechDetector, text, 'requirements.txt')).toEqual([
      'django:1',
      'flask:1',
      'langchain:1',
      'python:1',
      'pytorch:1',
    ]);
  });

  test('pyproject.toml: dependency arrays on one or many lines and poetry sections', () => {
    const text = [
      '[project]',
      'name = "demo"',
      'dependencies = ["fastapi>=0.110", \'tensorflow\']',
      '',
      '[project.optional-dependencies]',
      'dev = ["django"]',
      '',
      '[tool.hatch.envs.default]',
      'dependencies = [',
      '  "Flask",',
      "  'langgraph', # agents",
      '  "",',
      '  "torch]x",',
      ']',
      'after = "graphene"',
      '',
      '[tool.poetry.dependencies]',
      'python = "^3.12"',
      'Django = "^5"',
      '"quoted" = "1"',
      '',
      '[tool.poetry.group.dev.dependencies]',
      'strawberry-graphql = "*"',
      '',
      '[tool.poetry.dev-dependencies]',
      'langchain-openai = "*"',
      '',
      '[[tool.other]]',
      'flask = "1"',
    ].join('\n');
    expect(run(pythonTechDetector, text, 'pyproject.toml')).toEqual([
      'django:1',
      'fastapi:1',
      'flask:1',
      'graphql:1',
      'langchain:2',
      'python:1',
      'pytorch:1',
      'tensorflow:1',
    ]);
  });

  test('pyproject.toml: an array that never closes reads to the end of the file', () => {
    expect(
      run(pythonTechDetector, 'dependencies = [\n"django",\n"flask"', 'pyproject.toml'),
    ).toEqual(['django:1', 'flask:1', 'python:1']);
  });

  test('Pipfile: keys of packages and dev-packages only', () => {
    const text = [
      '[[source]]',
      'url = "https://pypi.org/simple"',
      '[packages]',
      'django = "*"',
      'fastapi = {version = "*"}',
      '[dev-packages]',
      'pytest = "*"',
      'torch = "*"',
      '[requires]',
      'python_version = "3.12"',
      'flask = "1"',
    ].join('\n');
    expect(run(pythonTechDetector, text, 'Pipfile')).toEqual([
      'django:1',
      'fastapi:1',
      'python:1',
      'pytorch:1',
    ]);
  });

  test('accepts only the three Python manifests', () => {
    expect(pythonTechDetector.accepts('setup.py')).toBe(false);
  });
});

describe('dotnet Tech_Detector (csproj and fsproj)', () => {
  test('counts the project file and the known NuGet package references', () => {
    const text = [
      '<Project Sdk="Microsoft.NET.Sdk.Web">',
      '  <ItemGroup>',
      '    <PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="8.0.0" />',
      "    <PackageReference Version='1' Include='Microsoft.AspNetCore.Authentication.JwtBearer' />",
      '    <PackageReference Include="HotChocolate.AspNetCore">',
      '      <Version>13</Version>',
      '    </PackageReference>',
      '    <!-- <PackageReference Include="GraphQL" /> -->',
      '    <PackageReference Include="AWSSDK.S3" />',
      '  </ItemGroup>',
      '</Project>',
    ].join('\n');
    expect(run(dotnetTechDetector, text, 'Api.csproj')).toEqual([
      'aspnet:2',
      'dotnet:1',
      'graphql:1',
    ]);
    expect(run(dotnetTechDetector, '<Project></Project>', 'Lib.fsproj')).toEqual(['dotnet:1']);
  });

  test('a project file with no root element counts nothing', () => {
    expect(dotnetTechDetector.detect('not xml at all', 'App.csproj')).toEqual([]);
    expect(dotnetTechDetector.accepts('App.vbproj')).toBe(false);
  });
});

describe('jvm Tech_Detector', () => {
  test('pom.xml: the project and every known artifactId outside comments', () => {
    const text = [
      '<project>',
      '  <parent><artifactId>spring-boot-starter-parent</artifactId></parent>',
      '  <artifactId>my-app</artifactId>',
      '  <dependency><artifactId> spring-boot-starter-web </artifactId></dependency>',
      '  <dependency><artifactId>kotlin-stdlib-jdk8</artifactId></dependency>',
      '  <!-- <dependency><artifactId>graphql-java</artifactId></dependency> -->',
      '  <dependency><artifactId></artifactId></dependency>',
      '</project>',
    ].join('\n');
    expect(run(jvmTechDetector, text, 'pom.xml')).toEqual(['java:1', 'kotlin:1', 'spring:2']);
  });

  test('pom.xml with no project element counts nothing', () => {
    expect(jvmTechDetector.detect('<html></html>', 'pom.xml')).toEqual([]);
  });

  test('build.gradle and build.gradle.kts: the artifact of each quoted coordinate', () => {
    const groovy = [
      "plugins { id 'org.springframework.boot' version '3.2.0' }",
      "implementation 'org.springframework.boot:spring-boot-starter-web'",
      'implementation "com.graphql-java:graphql-java:21.0"',
      "testImplementation 'junit:junit:4.13'",
      "url 'https://example.invalid'",
    ].join('\n');
    expect(run(jvmTechDetector, groovy, 'build.gradle')).toEqual([
      'graphql:1',
      'java:1',
      'spring:1',
    ]);
    const kotlin = 'dependencies {\n  implementation("org.jetbrains.kotlin:kotlin-stdlib")\n}';
    expect(run(jvmTechDetector, kotlin, 'build.gradle.kts')).toEqual(['java:1', 'kotlin:1']);
  });

  test('accepts only the JVM build files', () => {
    expect(jvmTechDetector.accepts('settings.gradle')).toBe(false);
  });
});

describe('ruby Tech_Detector (Gemfile)', () => {
  test('counts Ruby and the known gems', () => {
    const text = [
      "source 'https://rubygems.org'",
      "gem 'rails', '~> 7.1'",
      'gem("graphql")',
      '  gem "puma"',
      '# gem "rails"',
      'gemspec',
    ].join('\n');
    expect(run(rubyTechDetector, text, 'Gemfile')).toEqual(['graphql:1', 'rails:1', 'ruby:1']);
    expect(rubyTechDetector.accepts('Gemfile.lock')).toBe(false);
  });
});

describe('presence Tech_Detector', () => {
  test('counts one declaration for the manifest by its name', () => {
    const cases: [string, string, string][] = [
      ['go.mod', 'module example.com/x', 'go:1'],
      ['Cargo.toml', '[package]', 'rust:1'],
      ['composer.json', '{"require":{}}', 'php:1'],
      ['global.json', '{"sdk":{"version":"8.0.100"}}', 'dotnet:1'],
      ['All.sln', 'Microsoft Visual Studio Solution File', 'dotnet:1'],
      ['Dockerfile', 'FROM node:24', 'docker:1'],
      ['docker-compose.yml', 'services: {}', 'docker:1'],
      ['docker-compose.yaml', '', 'docker:1'],
      ['compose.yml', '', 'docker:1'],
      ['compose.yaml', '', 'docker:1'],
      ['Chart.yaml', 'apiVersion: v2', 'kubernetes:1'],
      ['kustomization.yaml', 'resources: []', 'kubernetes:1'],
      ['kustomization.yml', '', 'kubernetes:1'],
    ];
    for (const [fileName, text, expected] of cases) {
      expect(run(presenceTechDetector, text, fileName)).toEqual([expected]);
    }
  });

  test('a JSON manifest that does not parse to an object counts nothing', () => {
    expect(presenceTechDetector.detect('{', 'composer.json')).toEqual([]);
    expect(presenceTechDetector.detect('[]', 'global.json')).toEqual([]);
    expect(presenceTechDetector.accepts('values.yaml')).toBe(false);
  });
});

describe('XML helpers', () => {
  test('comments are removed, an unclosed one runs to the end', () => {
    expect(stripXmlComments('a<!-- b -->c<!-- d -->e')).toBe('ace');
    expect(stripXmlComments('a<!-- b')).toBe('a');
    expect(stripXmlComments('plain')).toBe('plain');
  });

  test('package references need a space after the tag name and a non-empty Include', () => {
    const text = [
      '<PackageReferences Include="Wrong" />',
      '<PackageReference Include="" />',
      '<PackageReference Update="Only.Update" />',
      '<PackageReference\n Include="Multi.Line" />',
      '<PackageReference Include="Unclosed"',
      '<Other />',
    ].join('\n');
    expect(packageReferences(text)).toEqual(['Multi.Line', 'Unclosed']);
    expect(packageReferences(`<PackageReference ${' '.repeat(600)}Include="Far" />`)).toEqual([]);
  });

  test('element texts are trimmed, empty and unclosed ones are skipped', () => {
    expect(elementTexts('<a>x</a><a> </a><a>y</a><a>z', 'a')).toEqual(['x', 'y']);
  });
});

describe('Tech_Detectors never throw', () => {
  const names = [
    'package.json',
    'requirements.txt',
    'pyproject.toml',
    'Pipfile',
    'App.csproj',
    'pom.xml',
    'build.gradle',
    'Gemfile',
    'composer.json',
    'go.mod',
  ];

  test('any text gives well-formed hits', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), fc.constantFrom(...names), (text, fileName) => {
        for (const detector of DEFAULT_TECH_DETECTORS) {
          if (detector.accepts(fileName)) {
            for (const hit of detector.detect(text, fileName)) {
              expect(hit.count).toBeGreaterThan(0);
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
