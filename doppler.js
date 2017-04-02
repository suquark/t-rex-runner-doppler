const AudioContext =
    window.AudioContext ||
    window.webkitAudioContext ||
    window.mozAudioContext ||
    window.oAudioContext ||
    window.msAudioContext;

navigator.getUserMedia =
    navigator.getUserMedia ||
    navigator.webkitGetUserMedia ||
    navigator.mozGetUserMedia ||
    navigator.msGetUserMedia;


class Doppler {
    constructor() {
        this.ctx = new AudioContext();

        this.osc = this.ctx.createOscillator();
        // This is just preliminary, we'll actually do a quick scan (as suggested in the paper) to optimize this.
        this.osc.frequency.value = 20000;
        this.osc.type = this.osc.SINE || this.osc.type;

        // See paper for this particular choice of frequencies
        this.relevantFreqWindow = 33;


        this.analyser = this.ctx.createAnalyser();
        this.analyser.smoothingTimeConstant = 0.5;
        this.analyser.fftSize = 2048;
        this.audioDataBuf = new Uint8Array(this.analyser.frequencyBinCount);

        this.readMicInterval = 0; // flag for setTimeout
    }

    getBandwidth(freqs) {
        var primaryTone = this.freqToIndex(this.osc.frequency.value);
        var primaryVolume = freqs[primaryTone];
        // This ratio is totally empirical (aka trial-and-error).
        var maxVolumeRatio = 0.001;

        var leftBandwidth = 0;
        do {
            leftBandwidth++;
            var volume = freqs[primaryTone - leftBandwidth];
            var normalizedVolume = volume / primaryVolume;
        } while (normalizedVolume > maxVolumeRatio && leftBandwidth < this.relevantFreqWindow);

        var rightBandwidth = 0;
        do {
            rightBandwidth++;
            var volume = freqs[primaryTone + rightBandwidth];
            var normalizedVolume = volume / primaryVolume;
        } while (normalizedVolume > maxVolumeRatio && rightBandwidth < this.relevantFreqWindow);

        return { left: leftBandwidth, right: rightBandwidth };
    }

    freqToIndex(freq) {
        var nyquist = this.ctx.sampleRate / 2;
        return Math.round(freq / nyquist * this.analyser.fftSize / 2);
    }

    indexToFreq(index) {
        var nyquist = this.ctx.sampleRate / 2;
        return nyquist / (this.analyser.fftSize / 2) * index;
    }

    optimizeFrequency(freqSweepStart, freqSweepEnd) {
        var oldFreq = this.osc.frequency.value;

        var maxAmp = 0;
        var maxAmpIndex = 0;

        var from = this.freqToIndex(freqSweepStart);
        var to = this.freqToIndex(freqSweepEnd);
        for (var i = from; i < to; i++) {
            this.osc.frequency.value = this.indexToFreq(i);
            let audioData = this.getAudioData();

            if (audioData[i] > maxAmp) {
                maxAmp = audioData[i];
                maxAmpIndex = i;
            }
        }
        // Sometimes the above procedure seems to fail, not sure why.
        // If that happends, just use the old value.
        this.osc.frequency.value = maxAmpIndex == 0 ? oldFreq : this.indexToFreq(maxAmpIndex);
    }

    getAudioData() {
        this.analyser.getByteFrequencyData(this.audioDataBuf);
        return this.audioDataBuf;
    }

    readMic(userCallback) {
        var audioData = this.getAudioData();

        var band = this.getBandwidth(audioData);
        userCallback(band);

        this.readMicInterval = setTimeout((hook) => this.readMic(hook), 1, userCallback);
    }

    handleMic(stream, userCallback) {
        // Mic
        var mic = this.ctx.createMediaStreamSource(stream);
        mic.connect(this.analyser);

        // Doppler tone
        this.osc.start(0);
        this.osc.connect(this.ctx.destination);

        // There seems to be some initial "warm-up" period
        // where all frequencies are significantly louder.
        // A quick timeout will hopefully decrease that bias effect.
        setTimeout(() => {
            // Optimize doppler tone
            this.optimizeFrequency(19000, 22000);

            clearInterval(this.readMicInterval);
            this.readMic(userCallback);
        }, 10);
    };

    trace(callback) {
        navigator.getUserMedia({ audio: { optional: [{ echoCancellation: false }] } },
            stream => {
                this.handleMic(stream, callback);
            },
            function() {
                console.log('Error!')
            });
    }

    stop() {
        clearInterval(readMicInterval);
    }

}