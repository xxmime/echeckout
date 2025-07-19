/**
 * Post-action cleanup script
 */

import {cleanup} from './index'

// Execute cleanup
cleanup().catch(error => {
  console.error('Cleanup failed:', error)
  process.exit(1)
})