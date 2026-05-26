<template>
    <div class="voice-debug-page">
        <div class="debug-container">
            <h3 class="text-h5 q-mb-md">🎤 Voice Debug</h3>

            <!-- Controls -->
            <div class="row q-gutter-sm q-mb-md">
                <q-btn color="primary" icon="mic" label="Start" :disable="isActive" @click="startTest" />
                <q-btn color="negative" icon="stop" label="Stop" :disable="!isActive" @click="stopTest" />
                <q-btn color="grey" icon="delete" label="Clear" @click="clearLog" />
                <q-btn flat color="primary" icon="content_copy" label="Copy log" @click="copyLog" />
            </div>

            <!-- Status -->
            <div class="q-mb-md">
                <q-badge :color="statusColor">{{ statusText }}</q-badge>
                <q-badge color="grey" class="q-ml-sm">Silence: {{ silenceDelay }}ms</q-badge>
            </div>

            <!-- Transcript -->
            <div class="debug-section">
                <div class="text-caption text-grey-7 q-mb-xs">Current transcript:</div>
                <div class="debug-transcript">{{ transcript || '(waiting...)' }}</div>
            </div>

            <!-- Final result (what will be sent) -->
            <div class="debug-section">
                <div class="text-caption text-grey-7 q-mb-xs">Final result (will be sent to LLM):</div>
                <div class="debug-accumulated">{{ finalResult || '(empty)' }}</div>
            </div>

            <!-- Log -->
            <div class="debug-section">
                <div class="text-caption text-grey-7 q-mb-xs">Event log:</div>
                <div class="debug-log" ref="logRef">
                    <div v-for="(entry, i) in log" :key="i" class="log-entry" :class="entry.type">
                        {{ entry.text }}
                    </div>
                    <div v-if="log.length === 0" class="text-grey-5">No events yet</div>
                </div>
            </div>

        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, nextTick } from 'vue';
import { speechRecognition } from 'src/services/speechRecognition';

export default defineComponent({
    name: 'VoiceDebugPage',

    setup() {
        const isActive = ref(false);
        const transcript = ref('');
        const accumulated = ref('');
        const silenceDelay = ref(1500);
        const statusText = ref('idle');
        const statusColor = ref('grey');
        const log = ref<Array<{ text: string; type: string }>>([]);
        const logRef = ref<HTMLElement | null>(null);

        function addLog(text: string, type = 'info') {
            const time = new Date().toLocaleTimeString();
            log.value.push({ text: `[${time}] ${text}`, type });
            nextTick(() => {
                if (logRef.value) {
                    logRef.value.scrollTop = logRef.value.scrollHeight;
                }
            });
        }

        function setStatus(text: string, color: string) {
            statusText.value = text;
            statusColor.value = color;
        }

        const finalResult = ref('');

        function clearLog() {
            log.value = [];
        }

        function copyLog() {
            const logText = log.value.map((e) => e.text).join('\n');
            const resultText = finalResult.value ? `\n\n=== FINAL RESULT ===\n${finalResult.value}` : '';
            const fullText = logText + resultText;
            navigator.clipboard.writeText(fullText).then(() => {
                addLog('📋 Log + result copied to clipboard');
            }).catch(() => {
                addLog('❌ Failed to copy');
            });
        }

        function startTest() {
            accumulated.value = '';
            transcript.value = '';
            finalResult.value = '';
            isActive.value = true;

            addLog('🚀 Started (continuous: true, interim: true)');

            speechRecognition.start({
                onResult(text: string) {
                    addLog(`📥 FINAL: "${text}"`);
                    accumulated.value = text;
                    finalResult.value = text;
                },
                onInterim(text: string) {
                    transcript.value = text;
                },
                onError(error: string) {
                    addLog(`❌ Error: ${error}`, 'error');
                    isActive.value = false;
                    setStatus('error', 'negative');
                },
                onEnd() {
                    addLog('🏁 onend fired');
                },
            });

            setStatus('listening', 'positive');
        }

        function stopTest() {
            speechRecognition.stop();
            isActive.value = false;
            setStatus('stopped', 'grey');
            addLog('⏹ Stopped');
        }

        return {
            isActive,
            transcript,
            accumulated,
            finalResult,
            silenceDelay,
            statusText,
            statusColor,
            log,
            logRef,
            startTest,
            stopTest,
            clearLog,
            copyLog,
        };
    },
});
</script>

<style scoped>
.voice-debug-page {
    padding: 20px;
    max-width: 600px;
    margin: 0 auto;
}

.debug-container {
    display: flex;
    flex-direction: column;
}

.debug-section {
    margin-bottom: 16px;
}

.debug-transcript {
    font-size: 18px;
    padding: 12px;
    background: #f5f5f5;
    border-radius: 8px;
    min-height: 40px;
    word-break: break-word;
}

.debug-accumulated {
    font-size: 14px;
    padding: 8px 12px;
    background: #fff3cd;
    border-radius: 8px;
    min-height: 30px;
    word-break: break-word;
}

.debug-log {
    height: 300px;
    overflow-y: auto;
    background: #1e1e1e;
    color: #d4d4d4;
    padding: 8px;
    border-radius: 8px;
    font-family: monospace;
    font-size: 11px;
    line-height: 1.5;
}

.log-entry {
    padding: 1px 0;
    border-bottom: 1px solid #2a2a2a;
}

.log-entry.error {
    color: #f48771;
}

.log-entry.info {
    color: #d4d4d4;
}
</style>
