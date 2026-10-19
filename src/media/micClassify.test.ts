import { describe, expect, it } from 'vitest';
import { classifyMicLabel } from './micClassify';

describe('classifyMicLabel', () => {
  it.each([
    ['Headset Microphone (Jabra EVOLVE 20 MS)', 'headset'],
    ['Communications - Headset Microphone (Realtek(R) Audio)', 'headset'],
    ['Headset (WH-1000XM4 Hands-Free AG Audio)', 'headset'],
    ['AirPods Pro', 'headset'],
    ['EarPods', 'headset'],
    ['External Microphone', 'headset'],
    ['Мікрофон (Гарнітура USB)', 'headset'],
    ['Microphone (USB Audio Device)', 'headset'],
    ['Microphone (Plantronics Blackwire 3220 Series)', 'headset'],
    ['Microphone (HyperX Cloud II)', 'headset'],
    ['Microphone (HATOR HYPERPUNK 3 - 7.1)', 'headset'],
    ['Microphone (Logitech USB Headset H390)', 'headset'],
  ])('%s → headset', (label, expected) => {
    expect(classifyMicLabel(label)).toBe(expected);
  });

  it.each([
    ['Default - Microphone Array (Intel® Smart Sound Technology for Digital Microphones)'],
    ['Microphone (Realtek(R) Audio)'],
    ['MacBook Pro Microphone'],
    ['Built-in Audio Analog Stereo'],
    ['Внутрішній мікрофон'],
    ['Встроенный микрофон'],
    // Мікрофон вебкамери — не гарнітура, навіть якщо бренд Logitech.
    ['Microphone (2- HD Pro Webcam C920)'],
    ['Microphone (Logitech BRIO)'],
  ])('%s → builtin', (label) => {
    expect(classifyMicLabel(label)).toBe('builtin');
  });

  it.each([[''], ['   '], ['Microphone'], ['Мікрофон (2- Some Device)']])('%j → unknown', (label) => {
    expect(classifyMicLabel(label)).toBe('unknown');
  });
});
