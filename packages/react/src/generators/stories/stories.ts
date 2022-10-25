import componentStoryGenerator from '../component-story/component-story';
import componentCypressSpecGenerator from '../component-cypress-spec/component-cypress-spec';
import {
  findExportDeclarationsForJsx,
  getComponentNode,
} from '../../utils/ast-utils';
import * as ts from 'typescript';
import {
  convertNxGenerator,
  getProjects,
  joinPathFragments,
  logger,
  ProjectConfiguration,
  Tree,
  visitNotIgnoredFiles,
} from '@nrwl/devkit';
import { basename, join } from 'path';
import {
  findStorybookAndBuildTargetsAndCompiler,
  isTheFileAStory,
} from '@nrwl/storybook/src/utils/utilities';
import minimatch = require('minimatch');

export interface StorybookStoriesSchema {
  project: string;
  generateCypressSpecs: boolean;
  js?: boolean;
  cypressProject?: string;
  ignorePaths?: string[];
}

export function projectRootPath(config: ProjectConfiguration): string {
  let projectDir: string;
  if (config.projectType === 'application') {
    const { nextBuildTarget } = findStorybookAndBuildTargetsAndCompiler(
      config.targets
    );
    if (!!nextBuildTarget) {
      // Next.js apps
      projectDir = 'components';
    } else {
      // apps/test-app/src/app
      projectDir = 'app';
    }
  } else if (config.projectType == 'library') {
    // libs/test-lib/src/*
    projectDir = '';
  }
  return joinPathFragments(config.sourceRoot, projectDir);
}

export function containsComponentDeclaration(
  tree: Tree,
  componentPath: string
): boolean {
  const contents = tree.read(componentPath, 'utf-8');
  if (contents === null) {
    throw new Error(`Failed to read ${componentPath}`);
  }

  const sourceFile = ts.createSourceFile(
    componentPath,
    contents,
    ts.ScriptTarget.Latest,
    true
  );

  return !!(
    getComponentNode(sourceFile) ||
    findExportDeclarationsForJsx(sourceFile)?.length
  );
}

export async function createAllStories(
  tree: Tree,
  projectName: string,
  generateCypressSpecs: boolean,
  js: boolean,
  cypressProject?: string,
  ignorePaths?: string[]
) {
  const projects = getProjects(tree);
  const projectConfiguration = projects.get(projectName);
  const { sourceRoot, root } = projectConfiguration;
  let componentPaths: string[] = [];

  visitNotIgnoredFiles(tree, projectRootPath(projectConfiguration), (path) => {
    // Ignore private files starting with "_".
    if (basename(path).startsWith('_')) return;

    if (ignorePaths?.some((pattern) => minimatch(path, pattern))) return;

    if (
      (path.endsWith('.tsx') && !path.endsWith('.spec.tsx')) ||
      (path.endsWith('.js') && !path.endsWith('.spec.js')) ||
      (path.endsWith('.jsx') && !path.endsWith('.spec.jsx'))
    ) {
      // Check if file is NOT a story (either ts/tsx or js/jsx)
      if (!isTheFileAStory(tree, path)) {
        // Since the file is not a story
        // Let's see if the .stories.* file exists
        const ext = path.slice(path.lastIndexOf('.'));
        const storyPath = `${path.split(ext)[0]}.stories${ext}`;

        if (!tree.exists(storyPath)) {
          componentPaths.push(path);
        }
      }
    }
  });

  const e2eProjectName = cypressProject || `${projectName}-e2e`;
  const e2eProject = projects.get(e2eProjectName);

  if (generateCypressSpecs && !e2eProject) {
    logger.info(
      `There was no e2e project "${e2eProjectName}" found, so cypress specs will not be generated. Pass "--cypressProject" to specify a different e2e project name`
    );
  }

  await Promise.all(
    componentPaths.map(async (componentPath) => {
      const relativeCmpDir = componentPath.replace(join(sourceRoot, '/'), '');

      if (!containsComponentDeclaration(tree, componentPath)) {
        return;
      }

      await componentStoryGenerator(tree, {
        componentPath: relativeCmpDir,
        project: projectName,
      });

      if (generateCypressSpecs && e2eProject) {
        await componentCypressSpecGenerator(tree, {
          project: projectName,
          componentPath: relativeCmpDir,
          js,
          cypressProject,
        });
      }
    })
  );
}

export async function storiesGenerator(
  host: Tree,
  schema: StorybookStoriesSchema
) {
  await createAllStories(
    host,
    schema.project,
    schema.generateCypressSpecs,
    schema.js,
    schema.cypressProject,
    schema.ignorePaths
  );
}

export default storiesGenerator;
export const storiesSchematic = convertNxGenerator(storiesGenerator);
