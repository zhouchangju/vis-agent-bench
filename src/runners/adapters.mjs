import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const defaultExecutables = {
  codex: 'codex',
  kimi: '/Users/leozhou/.kimi-code/bin/kimi',
  claude: 'claude',
};

function readPrompt(runDir, stageId) {
  return readFileSync(join(runDir, 'input', `stage-${stageId}.md`), 'utf8');
}

export function getAdapter(engine) {
  const adapters = {
    codex: {
      id: 'codex',
      executable: defaultExecutables.codex,
      versionArgs: ['--version'],
      session_continuity: 'native',
      build(spec, runDir, stageId, session) {
        const outputDir = join(runDir, 'artifacts');
        const prompt = readPrompt(runDir, stageId);
        if (session?.id) {
          return {
            executable: spec.engine.executable || defaultExecutables.codex,
            args: [
              'exec', 'resume',
              '--model', spec.engine.model,
              '--ignore-user-config',
              '--ignore-rules',
              '--json',
              '--output-last-message', join(outputDir, `final-message-${stageId}.md`),
              session.id,
              '-',
            ],
            stdin: prompt,
            format: 'jsonl',
          };
        }
        return {
          executable: spec.engine.executable || defaultExecutables.codex,
          args: [
            'exec',
            '--cd', join(runDir, 'workspace'),
            '--model', spec.engine.model,
            '--sandbox', 'workspace-write',
            '--ask-for-approval', 'never',
            '--ignore-user-config',
            '--ignore-rules',
            '--json',
            '--output-last-message', join(outputDir, `final-message-${stageId}.md`),
            '-',
          ],
          stdin: prompt,
          format: 'jsonl',
        };
      },
    },
    kimi: {
      id: 'kimi',
      executable: defaultExecutables.kimi,
      versionArgs: ['--version'],
      session_continuity: 'native-working-directory',
      build(spec, runDir, stageId, session) {
        const args = [
          '--auto',
          '--model', spec.engine.model,
          '--prompt', readPrompt(runDir, stageId),
          '--output-format', 'stream-json',
          '--skills-dir', join(runDir, '.empty-skills'),
        ];
        if (session?.started) args.unshift('--continue');
        return {
          executable: spec.engine.executable || defaultExecutables.kimi,
          args,
          stdin: null,
          format: 'jsonl',
        };
      },
    },
    claude: {
      id: 'claude',
      executable: defaultExecutables.claude,
      versionArgs: ['--version'],
      session_continuity: 'native',
      build(spec, runDir, stageId, session) {
        const args = [
          '--print',
          '--safe-mode',
          '--strict-mcp-config',
          '--no-chrome',
          '--model', spec.engine.model,
          '--permission-mode', 'auto',
          '--output-format', 'stream-json',
          '--include-hook-events',
        ];
        if (session?.started) args.push('--resume', session.id);
        else args.push('--session-id', session.id);
        if (spec.budget.max_cost_usd != null) {
          args.push('--max-budget-usd', String(spec.budget.max_cost_usd));
        }
        return {
          executable: spec.engine.executable || defaultExecutables.claude,
          args,
          stdin: readPrompt(runDir, stageId),
          format: 'jsonl',
        };
      },
    },
  };

  const adapter = adapters[engine];
  if (!adapter) throw new Error(`Unsupported engine: ${engine}`);
  return adapter;
}

export function listAdapters() {
  return ['codex', 'kimi', 'claude'].map(getAdapter);
}
