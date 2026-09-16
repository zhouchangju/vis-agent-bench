import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Semi-automatic (manual client) Runner Adapter.
 *
 * Implements the unified lifecycle (prepare → start_session → send_stage →
 * checkpoint → resume_session → collect) for runners that cannot be driven
 * programmatically via CLI.  Instead of calling `adapter.build` + `runCommand`,
 * the platform:
 *
 *   1. Generates a Run workspace with all necessary prompts.
 *   2. Writes a README instructing the user how to operate the workspace.
 *   3. Writes each stage prompt as a file under `input/`.
 *   4. Watches for checkpoint files under `.vab/checkpoints/`.
 *   5. When all stages complete, collects artifacts and runs evaluation
 *      automatically.
 *
 * This adapter is registered in adapters.mjs so it appears in `doctor` output.
 * It does NOT define `build` / `buildCommand` / `executable` / `versionArgs`
 * because it never spawns a CLI process.  The session lifecycle is managed by
 * `semi-automatic-session.mjs`.
 */

export const semiAutomaticAdapter = {
  id: 'semi-auto',
  label: 'Semi-automatic (manual client)',
  session_continuity: 'manual-checkpoint',

  /**
   * Write the initial README and first-stage prompt into the workspace.
   * Returns { status: 'awaiting_user', stageId: 'S0' } so the caller knows
   * which stage the user should start with.
   *
   * @param {{ paths: { inputDir: string, workspaceDir: string, logsDir: string, runDir: string },
   *            scenario: { stages: Array<{ id: string, name: string }> },
   *            stagePrompt: (stageId: string) => string }} ctx
   */
  async prepare(ctx) {
    const { paths, scenario, stagePrompt: resolvePrompt } = ctx;
    const { inputDir, workspaceDir, logsDir, runDir } = paths;

    // Write the README guide for the user.
    const readmePath = join(runDir, 'README-SEMI-AUTO.md');
    const stages = (scenario.stages || []).map(s => `- **${s.id}**: ${s.name || s.id}`).join('\n');
    writeFileSync(readmePath, [
      '# Semi-automatic Benchmark Run',
      '',
      'This is a **semi-automatic** run. Instead of the Harness driving',
      'a CLI agent directly, you operate the agent manually inside this',
      'workspace and confirm completion of each stage.',
      '',
      '## How to use this run',
      '',
      '1. Open your AI coding agent in the following workspace directory:',
      `   \`${runDir}/workspace\``,
      '',
      '2. Read the stage prompt in `input/stage-S0.md` and feed it to your',
      '   agent as the first message.',
      '',
      '3. When the agent finishes the stage deliverables, write a checkpoint',
      `   file at \`.vab/checkpoints/<stage-id>.json\` inside the workspace:`,
      '',
      '   ```json',
      '   {',
      '     "schema_version": 1,',
      '     "stage_id": "S0",',
      '     "artifacts": {',
      '       "checkpoint-name": ["relative/path/to/evidence"]',
      '     }',
      '   }',
      '   ```',
      '',
      '4. Run `node scripts/bench.mjs resume-semi-auto --run-dir <runDir>` to advance',
      '   to the next stage (or use watch mode).',
      '',
      '## Stages',
      '',
      stages,
      '',
      '## Important',
      '',
      '- Do NOT modify existing `scripts/*.mjs` files or `package.json` scripts.',
      '- Update `requirement-ledger.yaml` as required by each stage.',
      '- All checkpoint evidence must exist inside the workspace.',
      '- The Harness will automatically collect artifacts and run evaluation',
      '  after the final stage.',
      '',
    ].join('\n'));

    // Write the first stage prompt.
    const firstStage = scenario.stages?.[0];
    const firstStageId = firstStage?.id || 'S0';
    const stagePromptDir = join(inputDir);
    mkdirSync(stagePromptDir, { recursive: true });
    writeFileSync(
      join(stagePromptDir, `stage-${firstStageId}.md`),
      resolvePrompt(firstStageId),
    );

    // Create checkpoints directory in the workspace.
    mkdirSync(join(ctx.paths.workspaceDir, '.vab', 'checkpoints'), { recursive: true });

    return { status: 'awaiting_user', stageId: firstStageId };
  },

  /**
   * Check whether a checkpoint file exists for the given stage.
   *
   * @param {{ paths: { workspaceDir: string } }} ctx
   * @param {string} stageId
   * @returns {{ completed: boolean, reason?: string, checkpoint?: object }}
   */
  async checkStageCompletion(ctx, stageId) {
    const checkpointPath = join(ctx.paths.workspaceDir, '.vab', 'checkpoints', `${stageId}.json`);
    if (!existsSync(checkpointPath)) {
      return { completed: false, reason: 'checkpoint_file_missing' };
    }
    try {
      const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8'));
      if (checkpoint.schema_version !== 1 || checkpoint.stage_id !== stageId) {
        return { completed: false, reason: 'checkpoint_identity_mismatch', checkpoint };
      }
      return { completed: true, checkpoint, checkpointPath };
    } catch {
      return { completed: false, reason: 'checkpoint_parse_error' };
    }
  },

  /**
   * Write the next stage prompt to the input directory.
   *
   * @param {{ paths: { inputDir: string, workspaceDir: string },
   *            scenario: { stages: Array<{ id: string }> },
   *            stagePrompt: (stageId: string) => string }} ctx
   * @param {string} stageId
   */
  async advanceStage(ctx, stageId) {
    const prompt = ctx.stagePrompt(stageId);
    writeFileSync(join(ctx.paths.inputDir, `stage-${stageId}.md`), prompt);

    // Ensure checkpoints dir exists in workspace.
    mkdirSync(join(ctx.paths.workspaceDir, '.vab', 'checkpoints'), { recursive: true });

    return { status: 'stage_ready', stageId, inputPath: join(ctx.paths.inputDir, `stage-${stageId}.md`) };
  },

  /**
   * Collect final artifacts from the workspace.
   * This is a placeholder; the actual collection is handled by
   * semi-automatic-session.mjs (which mirrors bench.mjs's collect logic).
   *
   * @param {{ paths: { workspaceDir: string, logsDir: string } }} ctx
   */
  async collect(ctx) {
    return { status: 'collected', workspaceDir: ctx.paths.workspaceDir };
  },
};
