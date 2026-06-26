import { describe, it, expect } from 'vitest';
import { formatTime } from '../src/format-time';

describe('formatTime', () => {
    const testDate = new Date(2024, 0, 15, 8, 5, 3);

    it('should format with default format YYYY-MM-DD HH:mm:SS', () => {
        const result = formatTime(testDate);
        expect(result).toBe('2024-01-15 08:05:03');
    });

    it('should accept timestamp as number', () => {
        const result = formatTime(testDate.getTime());
        expect(result).toBe('2024-01-15 08:05:03');
    });

    it('should format with custom formatter function', () => {
        const formatter = (date: Date) => date.toISOString();
        const result = formatTime(testDate, formatter);
        expect(result).toBe(testDate.toISOString());
    });

    it('should handle date with single digit month and day', () => {
        const date = new Date(2024, 8, 5, 3, 2, 1);
        expect(formatTime(date)).toBe('2024-09-05 03:02:01');
    });

    it('should handle date with double digit month and day', () => {
        const date = new Date(2024, 10, 25, 12, 30, 45);
        expect(formatTime(date)).toBe('2024-11-25 12:30:45');
    });
});