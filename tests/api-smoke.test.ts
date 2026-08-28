import { describe, it, expect } from 'vitest';
import { fitWorldFile } from '../src/index.js';
import type { FitOptions, MaybePromise } from '../src/index.js';

const acceptsMaybePromise = <T>(value: MaybePromise<T>): MaybePromise<T> => value;

describe('API import smoke test', () => {
    it('should import module API properly', () => {
        const options: FitOptions = { debug: true };
        expect(typeof fitWorldFile).toBe('function');
        expect(acceptsMaybePromise(options)).toBe(options);
    });
});
