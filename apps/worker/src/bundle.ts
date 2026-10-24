// Pre-bundles the workflow code at build time so the worker starts fast and
// the runtime image does not need to run webpack.

import { writeFile } from 'node:fs/promises';
import { bundleWorkflowCode } from '@temporalio/worker';
import { workflowBundlePath, workflowsPath } from './workflows-path.js';

const { code } = await bundleWorkflowCode({ workflowsPath });
if (!code.includes('bookingRequestWorkflow')) throw new Error('Workflow bundle does not contain bookingRequestWorkflow');
await writeFile(workflowBundlePath, code);
console.log(`Wrote ${workflowBundlePath} (${Math.round(code.length / 1024)} KiB)`);
