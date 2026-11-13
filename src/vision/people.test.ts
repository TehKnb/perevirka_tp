import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { MultiPersonFilter, countFaces, countPoses } from './people';

const p = config.analysis;
const face = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y: y + h },
];
const pose = (cx: number, vis = 0.95) => {
  const lm = Array.from({ length: 13 }, () => ({ x: cx, y: 0.5, visibility: vis }));
  lm[0] = { x: cx, y: 0.3, visibility: vis };
  lm[11] = { x: cx + 0.15, y: 0.75, visibility: vis };
  lm[12] = { x: cx - 0.15, y: 0.75, visibility: vis };
  return lm;
};

describe('countFaces', () => {
  it('одне обличчя — одна людина', () => {
    expect(countFaces([face(0.4, 0.2, 0.2, 0.4)], p)).toBe(1);
    expect(countFaces([], p)).toBe(0);
  });

  it('друге обличчя співмірного розміру поруч — дві людини', () => {
    expect(countFaces([face(0.4, 0.2, 0.2, 0.4), face(0.75, 0.25, 0.12, 0.25)], p)).toBe(2);
  });

  it('дрібне обличчя (картина, фото на стіні) не рахується', () => {
    expect(countFaces([face(0.4, 0.2, 0.2, 0.4), face(0.05, 0.05, 0.05, 0.08)], p)).toBe(1);
  });

  it('те саме обличчя, знайдене двічі (накладається), не рахується', () => {
    expect(countFaces([face(0.4, 0.2, 0.2, 0.4), face(0.42, 0.25, 0.15, 0.3)], p)).toBe(1);
  });
});

describe('countPoses', () => {
  it('дві чітко видні пози далеко одна від одної — дві людини', () => {
    expect(countPoses([pose(0.3), pose(0.75)], p)).toBe(2);
  });

  it('друга поза ледь видна (меблі, складки одягу) — не рахується', () => {
    expect(countPoses([pose(0.5), pose(0.85, 0.3)], p)).toBe(1);
  });

  it('дві пози на тому самому місці — та сама людина', () => {
    expect(countPoses([pose(0.5), pose(0.55)], p)).toBe(1);
  });
});

describe('MultiPersonFilter', () => {
  it('друга людина рахується лише після кількох тіків поспіль', () => {
    const f = new MultiPersonFilter(3);
    expect([2, 2, 2, 2].map((n) => f.update(n))).toEqual([1, 1, 2, 2]);
  });

  it('одиночні спрацювання між кадрами з однією людиною не провалюють пункт', () => {
    const f = new MultiPersonFilter(3);
    expect([2, 1, 2, 2, 1, 2].map((n) => f.update(n))).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('одна людина або нікого — одразу', () => {
    const f = new MultiPersonFilter(3);
    expect([1, 0].map((n) => f.update(n))).toEqual([1, 0]);
  });
});
