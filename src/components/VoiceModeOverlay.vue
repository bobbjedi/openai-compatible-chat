<template>
    <transition name="voice-fade">
        <div v-if="voiceState.isActive.value" class="voice-overlay" @click.self="voiceModeService.stop()">
            <!-- Анимированный градиентный фон -->
            <div class="voice-bg-gradient" :class="`voice-bg--${voiceState.state.value}`" />

            <!-- Центральный контейнер -->
            <div class="voice-center">
                <!-- Анимированная сфера -->
                <div class="voice-sphere" :class="`voice-sphere--${voiceState.state.value}`">
                    <div class="voice-sphere-inner">
                        <template v-if="voiceState.state.value === 'listening'">
                            <q-icon name="mic" size="56px" color="white" />
                        </template>
                        <template v-else-if="voiceState.state.value === 'thinking'">
                            <q-icon name="psychology" size="56px" color="white" />
                        </template>
                        <template v-else-if="voiceState.state.value === 'speaking'">
                            <q-icon name="volume_up" size="56px" color="white" />
                        </template>
                    </div>
                </div>

                <!-- Статус -->
                <div class="voice-state-label">
                    <template v-if="voiceState.state.value === 'listening'">Listening</template>
                    <template v-else-if="voiceState.state.value === 'thinking'">Thinking</template>
                    <template v-else-if="voiceState.state.value === 'speaking'">Speaking</template>
                </div>

                <!-- Транскрипт -->
                <div v-if="voiceState.transcript.value" class="voice-transcript">
                    {{ voiceState.transcript.value }}
                </div>

                <!-- Reasoning -->
                <div v-if="voiceState.state.value === 'thinking' && voiceState.reasoning.value" class="voice-reasoning">
                    <div class="voice-reasoning-text">{{ voiceState.reasoning.value }}</div>
                </div>
            </div>

            <!-- Нижняя панель управления -->
            <div class="voice-bottom-bar">
                <div class="voice-controls-row">
                    <div class="voice-control-group">
                        <span class="voice-label">Silence</span>
                        <div class="voice-controls">
                            <q-btn flat dense round size="xs" icon="remove" color="grey-4"
                                @click="adjustSilence(-250)" />
                            <span class="voice-value">{{ silenceLabel }}</span>
                            <q-btn flat dense round size="xs" icon="add" color="grey-4" @click="adjustSilence(250)" />
                        </div>
                    </div>

                    <q-btn round size="md" flat class="voice-stop-btn" @click="voiceModeService.stop()">
                        <q-icon name="stop" size="24px" color="negative" />
                        <q-tooltip>Stop</q-tooltip>
                    </q-btn>

                    <div class="voice-control-group">
                        <span class="voice-label">Speed</span>
                        <div class="voice-controls">
                            <q-btn flat dense round size="xs" icon="remove" color="grey-4" @click="adjustRate(-0.05)" />
                            <span class="voice-value">{{ Math.round(localRate * 100) }}%</span>
                            <q-btn flat dense round size="xs" icon="add" color="grey-4" @click="adjustRate(0.05)" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </transition>
</template>

<script lang="ts">
import {
    defineComponent, ref, computed, watch, onMounted,
} from 'vue';
import { voiceState, voiceModeService } from 'src/services/voiceModeService';
import { useSettingsStore } from 'src/stores/settingsStore';

export default defineComponent({
    name: 'VoiceModeOverlay',

    setup() {
        const settingsStore = useSettingsStore();
        const localSilence = ref(voiceState.silenceDelay.value);
        const localRate = ref(voiceState.ttsRate.value);

        onMounted(async () => {
            await settingsStore.load();
            voiceModeService.setSilenceDelay(settingsStore.voiceSilenceDelay);
            voiceModeService.setTtsRate(settingsStore.ttsRate);
            localSilence.value = settingsStore.voiceSilenceDelay;
            localRate.value = settingsStore.ttsRate;
        });

        const silenceLabel = computed(() => {
            const sec = localSilence.value / 1000;
            return `${sec.toFixed(1)}s`;
        });

        function adjustSilence(delta: number) {
            const newVal = Math.max(500, Math.min(5000, localSilence.value + delta));
            localSilence.value = newVal;
            voiceModeService.setSilenceDelay(newVal);
            settingsStore.saveVoiceSilenceDelay(newVal);
        }

        function onSilenceChange(val: number | null) {
            if (val !== null) {
                voiceModeService.setSilenceDelay(val);
                settingsStore.saveVoiceSilenceDelay(val);
            }
        }

        function adjustRate(delta: number) {
            const newVal = Math.max(0.3, Math.min(2.0, localRate.value + delta));
            localRate.value = newVal;
            voiceModeService.setTtsRate(newVal);
            settingsStore.saveTtsRate(newVal);
        }

        function onRateChange(val: number | null) {
            if (val !== null) {
                voiceModeService.setTtsRate(val);
                settingsStore.saveTtsRate(val);
            }
        }

        // Sync local values when service changes
        watch(() => voiceState.silenceDelay.value, (val) => {
            localSilence.value = val;
        });

        watch(() => voiceState.ttsRate.value, (val) => {
            localRate.value = val;
        });

        return {
            voiceState,
            voiceModeService,
            localSilence,
            localRate,
            silenceLabel,
            adjustSilence,
            onSilenceChange,
            adjustRate,
            onRateChange,
        };
    },
});
</script>

<style scoped>
.voice-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: white;
    overflow: hidden;
    background: #0a0a0f;
}

/* ---- Gradient background ---- */
.voice-bg-gradient {
    position: absolute;
    top: -50%;
    left: -50%;
    width: 200%;
    height: 200%;
    background: radial-gradient(ellipse at 30% 50%, rgba(59, 130, 246, 0.08) 0%, transparent 60%),
        radial-gradient(ellipse at 70% 50%, rgba(34, 197, 94, 0.05) 0%, transparent 60%);
    animation: gradient-shift 8s ease-in-out infinite alternate;
    transition: background 0.5s ease;
}

.voice-bg--thinking {
    background: radial-gradient(ellipse at 30% 50%, rgba(245, 158, 11, 0.12) 0%, transparent 60%),
        radial-gradient(ellipse at 70% 50%, rgba(245, 158, 11, 0.06) 0%, transparent 60%);
}

.voice-bg--speaking {
    background: radial-gradient(ellipse at 30% 50%, rgba(34, 197, 94, 0.12) 0%, transparent 60%),
        radial-gradient(ellipse at 70% 50%, rgba(34, 197, 94, 0.06) 0%, transparent 60%);
}

@keyframes gradient-shift {
    0% {
        transform: translate(0, 0) rotate(0deg);
    }

    100% {
        transform: translate(-5%, -5%) rotate(5deg);
    }
}

/* ---- Center ---- */
.voice-center {
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
}

/* ---- Sphere ---- */
.voice-sphere {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    transition: all 0.5s ease;
}

.voice-sphere--listening {
    background: radial-gradient(circle at 35% 35%, rgba(59, 130, 246, 0.4), rgba(37, 99, 235, 0.6));
    box-shadow: 0 0 60px rgba(59, 130, 246, 0.3), inset 0 0 40px rgba(59, 130, 246, 0.1);
    animation: sphere-pulse-listening 2s ease-in-out infinite;
}

.voice-sphere--thinking {
    background: radial-gradient(circle at 35% 35%, rgba(245, 158, 11, 0.4), rgba(217, 119, 6, 0.6));
    box-shadow: 0 0 60px rgba(245, 158, 11, 0.3), inset 0 0 40px rgba(245, 158, 11, 0.1);
    animation: sphere-pulse-thinking 1.5s ease-in-out infinite;
}

.voice-sphere--speaking {
    background: radial-gradient(circle at 35% 35%, rgba(34, 197, 94, 0.4), rgba(22, 163, 74, 0.6));
    box-shadow: 0 0 60px rgba(34, 197, 94, 0.3), inset 0 0 40px rgba(34, 197, 94, 0.1);
    animation: sphere-pulse-speaking 0.8s ease-in-out infinite;
}

.voice-sphere-inner {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(circle at 35% 35%, rgba(255, 255, 255, 0.15), transparent 60%);
}

@keyframes sphere-pulse-listening {

    0%,
    100% {
        transform: scale(1);
        box-shadow: 0 0 60px rgba(59, 130, 246, 0.3);
    }

    50% {
        transform: scale(1.05);
        box-shadow: 0 0 80px rgba(59, 130, 246, 0.4);
    }
}

@keyframes sphere-pulse-thinking {

    0%,
    100% {
        transform: scale(1);
        box-shadow: 0 0 60px rgba(245, 158, 11, 0.3);
    }

    50% {
        transform: scale(1.02);
        box-shadow: 0 0 70px rgba(245, 158, 11, 0.35);
    }
}

@keyframes sphere-pulse-speaking {

    0%,
    100% {
        transform: scale(1);
        box-shadow: 0 0 60px rgba(34, 197, 94, 0.3);
    }

    50% {
        transform: scale(1.08);
        box-shadow: 0 0 90px rgba(34, 197, 94, 0.45);
    }
}

/* ---- State label ---- */
.voice-state-label {
    font-size: 15px;
    font-weight: 400;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.5);
}

/* ---- Transcript ---- */
.voice-transcript {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.6);
    text-align: center;
    max-width: 70%;
    line-height: 1.5;
    padding: 10px 18px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 16px;
    min-height: 20px;
    backdrop-filter: blur(10px);
}

/* ---- Reasoning ---- */
.voice-reasoning {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 100px 60px;
    pointer-events: none;
}

.voice-reasoning-text {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.1);
    text-align: center;
    max-width: 60%;
    line-height: 1.6;
    max-height: 40vh;
    overflow-y: auto;
    font-style: italic;
}

/* ---- Bottom bar ---- */
.voice-bottom-bar {
    position: absolute;
    bottom: 40px;
    left: 0;
    right: 0;
    z-index: 10;
    display: flex;
    justify-content: center;
    padding: 0 20px;
}

.voice-controls-row {
    display: flex;
    align-items: center;
    gap: 32px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 20px;
    padding: 12px 24px;
    backdrop-filter: blur(12px);
}

.voice-control-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 80px;
}

.voice-label {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.3);
    text-transform: uppercase;
    letter-spacing: 1px;
}

.voice-controls {
    display: flex;
    align-items: center;
    gap: 6px;
}

.voice-value {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.7);
    min-width: 36px;
    text-align: center;
    font-variant-numeric: tabular-nums;
}

.voice-stop-btn {
    width: 44px;
    height: 44px;
    background: rgba(220, 38, 38, 0.1);
    border: 1px solid rgba(220, 38, 38, 0.2);
    transition: all 0.2s ease;
}

.voice-stop-btn:hover {
    background: rgba(220, 38, 38, 0.2);
    border-color: rgba(220, 38, 38, 0.4);
}

/* ---- Transition ---- */
.voice-fade-enter-active,
.voice-fade-leave-active {
    transition: opacity 0.3s ease;
}

.voice-fade-enter-from,
.voice-fade-leave-to {
    opacity: 0;
}
</style>
