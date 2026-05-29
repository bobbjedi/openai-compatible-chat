<template>
    <transition name="voice-fade">
        <div v-if="stepVoiceState.isActive.value" class="step-voice-overlay" @click.self="stepVoiceService.stop()">

            <!-- Верхняя панель — таймаут автоотправки -->
            <div class="step-voice-top-bar">
                <div class="step-voice-controls-row">
                    <div class="step-voice-control-group">
                        <div class="step-voice-label-row">
                            <span class="step-voice-label">AutoSend</span>
                            <q-toggle v-model="autoSendEnabled" dense size="sm" color="positive"
                                @update:model-value="onAutoSendToggle" />
                        </div>
                        <div class="step-voice-controls">
                            <q-btn round size="md" flat class="step-voice-rate-btn" icon="remove" color="grey-4"
                                @click="adjustTimeout(-500)" />
                            <span class="step-voice-value">{{ timeoutLabel }}</span>
                            <q-btn round size="md" flat class="step-voice-rate-btn" icon="add" color="grey-4"
                                @click="adjustTimeout(500)" />
                        </div>
                    </div>
                </div>
            </div>

            <!-- Центральная кнопка (фикс. высота, кнопка всегда по центру) -->
            <div class="step-voice-center">
                <div class="step-voice-label">{{ statusLabel }}</div>
                <div class="step-voice-button-wrapper">
                    <div class="step-voice-button" :class="buttonClass" @click="onButtonClick">
                        <template v-if="stepVoiceState.state.value === 'idle'">
                            <q-icon name="mic" size="64px" color="white" />
                        </template>
                        <template v-else-if="stepVoiceState.state.value === 'listening'">
                            <q-icon v-if="stepVoiceState.transcript.value" name="send" size="64px" color="white" />
                            <q-icon v-else name="mic" size="64px" color="white" />
                        </template>
                        <template v-else-if="stepVoiceState.state.value === 'thinking'">
                            <q-spinner-dots size="48px" color="white" />
                        </template>
                        <template v-else-if="stepVoiceState.state.value === 'speaking'">
                            <q-icon name="stop" size="64px" color="white" />
                        </template>
                    </div>
                </div>
            </div>

            <!-- Транскрипт — набираемый текст (слушаем) -->
            <div v-if="stepVoiceState.transcript.value && stepVoiceState.state.value !== 'speaking'" ref="transcriptRef"
                class="step-voice-transcript step-voice-transcript--input">
                {{ stepVoiceState.transcript.value }}
            </div>

            <!-- Транскрипт — ответ GPT (говорим) -->
            <div v-if="stepVoiceState.responseText.value && stepVoiceState.state.value === 'speaking'"
                ref="transcriptRef" class="step-voice-transcript step-voice-transcript--response">
                {{ stepVoiceState.responseText.value }}
            </div>

            <!-- Подсказка -->
            <div v-if="stepVoiceState.state.value === 'listening' && stepVoiceState.transcript.value"
                class="step-voice-hint">
                Tap to send
            </div>

            <!-- Нижняя панель — скорость речи -->
            <div class="step-voice-bottom-bar">
                <div class="step-voice-controls-row">
                    <div class="step-voice-control-group">
                        <span class="step-voice-label">Speed</span>
                        <div class="step-voice-controls">
                            <q-btn round size="md" flat class="step-voice-rate-btn" icon="remove" color="grey-4"
                                @click="adjustRate(-0.05)" />
                            <span class="step-voice-value">{{ Math.round(localRate * 100) }}%</span>
                            <q-btn round size="md" flat class="step-voice-rate-btn" icon="add" color="grey-4"
                                @click="adjustRate(0.05)" />
                        </div>
                    </div>
                </div>
            </div>

            <!-- Кнопка закрытия -->
            <div class="step-voice-close" @click="stepVoiceService.stop()">
                <q-icon name="close" size="28px" color="grey-4" />
            </div>
        </div>
    </transition>
</template>

<script lang="ts">
import {
    defineComponent, ref, computed, watch, onMounted, nextTick,
} from 'vue';
import { stepVoiceState, stepVoiceService } from 'src/services/stepVoiceService';
import { speechRecognition } from 'src/services/speechRecognition';
import { useSettingsStore } from 'src/stores/settingsStore';

export default defineComponent({
    name: 'StepVoiceOverlay',

    setup() {
        const settingsStore = useSettingsStore();
        const localRate = ref(settingsStore.ttsRate);
        const localTimeout = ref(settingsStore.stepVoiceTimeout);
        const savedTimeout = ref(settingsStore.stepVoiceTimeout || 3000);
        const autoSendEnabled = ref(settingsStore.stepVoiceTimeout > 0);
        const transcriptRef = ref<HTMLElement | null>(null);

        // Auto-scroll transcript when text changes
        watch(() => stepVoiceState.transcript.value, () => {
            nextTick(() => {
                if (transcriptRef.value) {
                    transcriptRef.value.scrollTop = transcriptRef.value.scrollHeight;
                }
            });
        });

        onMounted(async () => {
            await settingsStore.load();
            localRate.value = settingsStore.ttsRate;
            localTimeout.value = settingsStore.stepVoiceTimeout;
        });

        const timeoutLabel = computed(() => {
            if (localTimeout.value <= 0) return 'OFF';
            const sec = localTimeout.value / 1000;
            return `${sec.toFixed(1)}s`;
        });

        function adjustRate(delta: number) {
            const newVal = Math.max(0.3, Math.min(2.0, localRate.value + delta));
            localRate.value = newVal;
            settingsStore.saveTtsRate(newVal);
        }

        function adjustTimeout(delta: number) {
            const newVal = Math.max(0, Math.min(10000, localTimeout.value + delta));
            localTimeout.value = newVal;
            settingsStore.saveStepVoiceTimeout(newVal);
            if (newVal > 0) {
                savedTimeout.value = newVal;
                autoSendEnabled.value = true;
            } else {
                autoSendEnabled.value = false;
            }
        }

        function onAutoSendToggle(val: boolean) {
            autoSendEnabled.value = val;
            if (val) {
                localTimeout.value = savedTimeout.value;
                settingsStore.saveStepVoiceTimeout(savedTimeout.value);
            } else {
                localTimeout.value = 0;
                settingsStore.saveStepVoiceTimeout(0);
            }
        }

        function stopSpeaking() {
            window.speechSynthesis.cancel();
            stepVoiceState.state.value = 'idle';
        }

        const statusLabel = computed(() => {
            switch (stepVoiceState.state.value) {
                case 'idle': return 'Tap to speak';
                case 'listening': return 'Listening...';
                case 'thinking': return 'Thinking...';
                case 'speaking': return 'Speaking...';
                default: return '';
            }
        });

        const buttonClass = computed(() => {
            const base = stepVoiceState.state.value;
            // listening with text → green (send), without text → red (mic)
            if (base === 'listening' && stepVoiceState.transcript.value) {
                return 'step-voice-btn--hasText';
            }
            return `step-voice-btn--${base}`;
        });

        function onButtonClick() {
            switch (stepVoiceState.state.value) {
                case 'idle':
                    stepVoiceService.startListening();
                    break;
                case 'listening':
                    // Stop mic and send accumulated text
                    stepVoiceService.send();
                    break;
                case 'speaking':
                    // Stop TTS, restart mic fresh
                    stepVoiceService.stopSpeaking();
                    speechRecognition.stop();
                    stepVoiceState.state.value = 'listening';
                    stepVoiceService.startListening();
                    break;
                case 'thinking':
                    // Do nothing
                    break;
                default:
                    break;
            }
        }

        return {
            stepVoiceState,
            stepVoiceService,
            statusLabel,
            buttonClass,
            onButtonClick,
            localRate,
            localTimeout,
            timeoutLabel,
            autoSendEnabled,
            transcriptRef,
            adjustRate,
            adjustTimeout,
            onAutoSendToggle,
            stopSpeaking,
        };
    },
});
</script>

<style scoped>
.step-voice-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(10, 10, 15, 0.95);
    color: white;
}

.step-voice-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 220px;
    justify-content: center;
    margin-top: 0;
}

.step-voice-button-wrapper {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
}

.step-voice-button {
    width: 140px;
    height: 140px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.3s ease;
}

.step-voice-btn--idle {
    background: radial-gradient(circle at 35% 35%, rgba(59, 130, 246, 0.4), rgba(37, 99, 235, 0.6));
    box-shadow: 0 0 60px rgba(59, 130, 246, 0.3);
}

.step-voice-btn--idle:hover {
    transform: scale(1.05);
    box-shadow: 0 0 80px rgba(59, 130, 246, 0.5);
}

.step-voice-btn--listening {
    background: radial-gradient(circle at 35% 35%, rgba(239, 68, 68, 0.4), rgba(220, 38, 38, 0.6));
    box-shadow: 0 0 60px rgba(239, 68, 68, 0.3);
    animation: step-pulse-listening 1.5s ease-in-out infinite;
}

.step-voice-btn--hasText {
    background: radial-gradient(circle at 35% 35%, rgba(34, 197, 94, 0.4), rgba(22, 163, 74, 0.6));
    box-shadow: 0 0 60px rgba(34, 197, 94, 0.3);
    animation: step-pulse-listening 1.5s ease-in-out infinite;
}

.step-voice-btn--thinking {
    background: radial-gradient(circle at 35% 35%, rgba(245, 158, 11, 0.4), rgba(217, 119, 6, 0.6));
    box-shadow: 0 0 60px rgba(245, 158, 11, 0.3);
}

.step-voice-btn--speaking {
    background: radial-gradient(circle at 35% 35%, rgba(34, 197, 94, 0.4), rgba(22, 163, 74, 0.6));
    box-shadow: 0 0 60px rgba(34, 197, 94, 0.3);
    animation: step-pulse-speaking 0.8s ease-in-out infinite;
}

@keyframes step-pulse-listening {

    0%,
    100% {
        transform: scale(1);
        box-shadow: 0 0 60px rgba(239, 68, 68, 0.3);
    }

    50% {
        transform: scale(1.08);
        box-shadow: 0 0 90px rgba(239, 68, 68, 0.5);
    }
}

@keyframes step-pulse-speaking {

    0%,
    100% {
        transform: scale(1);
        box-shadow: 0 0 60px rgba(34, 197, 94, 0.3);
    }

    50% {
        transform: scale(1.05);
        box-shadow: 0 0 80px rgba(34, 197, 94, 0.5);
    }
}

.step-voice-label {
    font-size: 15px;
    font-weight: 400;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.5);
}

.step-voice-transcript--input {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
}

.step-voice-transcript--response {
    background: rgba(34, 197, 94, 0.08);
    border: 1px solid rgba(34, 197, 94, 0.15);
}

.step-voice-transcript {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, 100px);
    font-size: 13px;
    color: rgba(255, 255, 255, 0.8);
    text-align: center;
    line-height: 1.4;
    padding: 10px 16px;
    border-radius: 16px;
    width: 280px;
    height: 80px;
    overflow-y: auto;
    z-index: 15;
}

.step-voice-hint {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, 160px);
    font-size: 12px;
    color: rgba(255, 255, 255, 0.35);
    letter-spacing: 1px;
    text-transform: uppercase;
    z-index: 15;
}

.step-voice-bottom-bar {
    position: absolute;
    bottom: 40px;
    left: 0;
    right: 0;
    z-index: 10;
    display: flex;
    justify-content: center;
    padding: 0 20px;
}

.step-voice-top-bar {
    position: absolute;
    top: 80px;
    left: 0;
    right: 0;
    z-index: 10;
    display: flex;
    justify-content: center;
    padding: 0 20px;
}

.step-voice-controls-row {
    display: flex;
    align-items: center;
    gap: 32px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 20px;
    padding: 10px 24px;
    backdrop-filter: blur(12px);
}

.step-voice-label-row {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    position: relative;
}

.step-voice-label-row .q-toggle {
    position: absolute;
    right: 0;
}

.step-voice-control-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 100px;
}

.step-voice-controls {
    display: flex;
    align-items: center;
    gap: 12px;
}

.step-voice-value {
    font-size: 20px;
    color: rgba(255, 255, 255, 0.8);
    min-width: 56px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
}

.step-voice-rate-btn {
    width: 56px;
    height: 56px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    transition: all 0.2s ease;
}

.step-voice-rate-btn:hover {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.2);
}

.step-voice-rate-btn .q-icon {
    font-size: 28px;
}

.step-voice-stop-btn {
    width: 44px;
    height: 44px;
    background: rgba(220, 38, 38, 0.1);
    border: 1px solid rgba(220, 38, 38, 0.2);
    transition: all 0.2s ease;
}

.step-voice-stop-btn:hover {
    background: rgba(220, 38, 38, 0.2);
    border-color: rgba(220, 38, 38, 0.4);
}

.step-voice-close {
    position: absolute;
    top: 20px;
    right: 20px;
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.05);
    transition: background 0.2s;
}

.step-voice-close:hover {
    background: rgba(255, 255, 255, 0.1);
}

.voice-fade-enter-active,
.voice-fade-leave-active {
    transition: opacity 0.3s ease;
}

.voice-fade-enter-from,
.voice-fade-leave-to {
    opacity: 0;
}
</style>
