<template>
    <transition name="voice-fade">
        <div v-if="voiceState.isActive.value" class="voice-overlay" @click.self="voiceModeService.stop()">
            <!-- Анимация фона — пульсирующие круги -->
            <div class="voice-bg-animation" :class="`voice-bg--${voiceState.state.value}`">
                <div class="voice-circle voice-circle--1" />
                <div class="voice-circle voice-circle--2" />
                <div class="voice-circle voice-circle--3" />
            </div>

            <!-- Верхняя панель: регулировка паузы тишины -->
            <div class="voice-top-bar">
                <div class="voice-control-group">
                    <span class="voice-label">Silence: {{ silenceLabel }}</span>
                    <div class="voice-controls">
                        <q-btn flat dense round size="sm" icon="remove" color="white" @click="adjustSilence(-250)" />
                        <q-slider v-model="localSilence" :min="500" :max="5000" :step="250" style="width: 120px"
                            color="white" :label-value="`${Math.round(localSilence / 1000 * 10) / 10}s`"
                            @update:model-value="onSilenceChange" />
                        <q-btn flat dense round size="sm" icon="add" color="white" @click="adjustSilence(250)" />
                    </div>
                </div>
            </div>

            <!-- Центр: состояние и транскрипт -->
            <div class="voice-center">
                <div class="voice-state-icon">
                    <template v-if="voiceState.state.value === 'listening'">
                        <q-icon name="mic" size="48px" color="white" class="voice-pulse" />
                    </template>
                    <template v-else-if="voiceState.state.value === 'thinking'">
                        <q-spinner-puff size="48px" color="warning" />
                    </template>
                    <template v-else-if="voiceState.state.value === 'speaking'">
                        <q-icon name="volume_up" size="48px" color="positive" class="voice-pulse" />
                    </template>
                </div>

                <div class="voice-state-label">
                    <template v-if="voiceState.state.value === 'listening'">Listening...</template>
                    <template v-else-if="voiceState.state.value === 'thinking'">Thinking...</template>
                    <template v-else-if="voiceState.state.value === 'speaking'">Speaking...</template>
                </div>

                <div v-if="voiceState.transcript.value" class="voice-transcript">
                    {{ voiceState.transcript.value }}
                </div>

                <!-- Reasoning — показывается когда LLM думает -->
                <div v-if="voiceState.state.value === 'thinking' && voiceState.reasoning.value" class="voice-reasoning">
                    <div class="voice-reasoning-label">Reasoning</div>
                    <div class="voice-reasoning-text">{{ voiceState.reasoning.value }}</div>
                </div>
            </div>

            <!-- Нижняя панель: скорость TTS + Stop -->
            <div class="voice-bottom-bar">
                <div class="voice-control-group">
                    <span class="voice-label">Speed: {{ Math.round(localRate * 100) }}%</span>
                    <div class="voice-controls">
                        <q-btn flat dense round size="sm" icon="remove" color="white" @click="adjustRate(-0.05)" />
                        <q-slider v-model="localRate" :min="0.3" :max="2.0" :step="0.05" style="width: 120px"
                            color="white" @update:model-value="onRateChange" />
                        <q-btn flat dense round size="sm" icon="add" color="white" @click="adjustRate(0.05)" />
                    </div>
                </div>

                <q-btn round size="lg" color="negative" icon="stop" class="voice-stop-btn"
                    @click="voiceModeService.stop()">
                    <q-tooltip>Stop Voice Mode</q-tooltip>
                </q-btn>
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
    background: rgba(0, 0, 0, 0.92);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    padding: 40px 20px;
    color: white;
    overflow: hidden;
}

/* ---- Background animation ---- */
.voice-bg-animation {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 300px;
    height: 300px;
}

.voice-circle {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    border: 2px solid;
    opacity: 0.3;
    animation: voice-pulse 2s ease-in-out infinite;
}

.voice-circle--1 {
    width: 100px;
    height: 100px;
    animation-delay: 0s;
}

.voice-circle--2 {
    width: 180px;
    height: 180px;
    animation-delay: 0.5s;
}

.voice-circle--3 {
    width: 260px;
    height: 260px;
    animation-delay: 1s;
}

/* State colors */
.voice-bg--listening .voice-circle {
    border-color: #3b82f6;
}

.voice-bg--thinking .voice-circle {
    border-color: #f59e0b;
}

.voice-bg--speaking .voice-circle {
    border-color: #22c55e;
}

@keyframes voice-pulse {

    0%,
    100% {
        transform: translate(-50%, -50%) scale(1);
        opacity: 0.3;
    }

    50% {
        transform: translate(-50%, -50%) scale(1.1);
        opacity: 0.6;
    }
}

/* ---- Top / Bottom bars ---- */
.voice-top-bar,
.voice-bottom-bar {
    position: relative;
    z-index: 10;
    width: 100%;
    display: flex;
    justify-content: center;
}

.voice-bottom-bar {
    flex-direction: column;
    align-items: center;
    gap: 20px;
}

.voice-control-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
}

.voice-label {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.voice-controls {
    display: flex;
    align-items: center;
    gap: 8px;
}

/* ---- Center state ---- */
.voice-center {
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
}

.voice-state-icon {
    width: 64px;
    height: 64px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.voice-pulse {
    animation: voice-icon-pulse 1.5s ease-in-out infinite;
}

@keyframes voice-icon-pulse {

    0%,
    100% {
        opacity: 1;
        transform: scale(1);
    }

    50% {
        opacity: 0.6;
        transform: scale(1.1);
    }
}

.voice-state-label {
    font-size: 18px;
    font-weight: 500;
    letter-spacing: 0.5px;
}

.voice-transcript {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.7);
    text-align: center;
    max-width: 80%;
    line-height: 1.4;
    padding: 12px 20px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    min-height: 20px;
}

.voice-stop-btn {
    box-shadow: 0 4px 16px rgba(220, 38, 38, 0.4);
}

/* ---- Reasoning display ---- */
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
    padding: 80px 40px;
    pointer-events: none;
}

.voice-reasoning-label {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.25);
    text-transform: uppercase;
    letter-spacing: 2px;
    margin-bottom: 12px;
}

.voice-reasoning-text {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.15);
    text-align: center;
    max-width: 70%;
    line-height: 1.6;
    max-height: 50vh;
    overflow-y: auto;
    font-style: italic;
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
