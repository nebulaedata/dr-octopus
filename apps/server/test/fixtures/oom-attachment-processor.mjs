/**
 * @author root
 * @description Emits the stable Node heap exhaustion signature before exiting to verify safe crash diagnostics.
 */

process.stderr.write(
  'FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory\n'
);
process.exitCode = 9;
