// Every page makes the same recorder; one that was recording on the last page carries on.
window.rec = TraceAvatarRecord.createRecorder({ title: 'across pages', persistKey: 'e2e', allowSynthetic: false });
