import { assert } from 'chai'
import 'mocha'
import { isWithinLimits } from '../../src/modules/btc/BTCHandler'

describe('btc_utils', () => { 

    it('isWithinLimits', () => {

        // 270 - 266: is not within limits
        assert.isFalse(isWithinLimits(
            "00000000000000000025c1910000000000000000000000000000000000000000",
            "0000000000000000002c0da70000000000000000000000000000000000000000",
            15
        ))

        // 270 - 267: is within limits
        assert.isTrue(isWithinLimits(
            "00000000000000000025c1910000000000000000000000000000000000000000",
            "00000000000000000029d72d0000000000000000000000000000000000000000",
            15
        ))

     })
})