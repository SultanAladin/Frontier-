import assert from 'node:assert/strict';
export default {
    BeforeFrame(Host, Frame) {
        const Mode = Frame % 3;
        // The headless host has no canvas; exercise the same callback and header path as the HMI.
        Host.Cabin.Screen = { ViewMode: Mode };
        Host.Cabin.ApplyMaterial('paint', '#9eb8df', Frame % 2 ? 'matte' : 'gloss');
        Host.Cabin.ApplyMaterial('wheel', '#d4bd88', 'gloss');
        assert.equal(Host.QueryCabinHeader().ViewMode, Mode);
        const Record = Host.Carcass.EncodeRecord(Host.QueryCabinHeader(), false);
        assert.equal(new Float32Array(Record)[7], Mode);
        assert.equal(Host.Materials[6].CoatWeight, Frame % 2 ? 0 : 1);
        // Do not supply a fake canvas screen to CabinSequence's artwork update.
        delete Host.Cabin.Screen;
    },
    Report() { console.log('Material upload, GI recapture and all three view modes exercised.'); }
};
