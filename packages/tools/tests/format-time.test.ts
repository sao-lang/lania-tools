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

    it('should format with custom string formatter using hyphen separator', () => {
        const result = formatTime(testDate, 'YYYY-MM-DD HH:mm');
        expect(result).toBe('2024-01-15 08:05');
    });

    it('should format with custom string formatter using slash separator', () => {
        const result = formatTime(testDate, 'YYYY/MM/DD');
        expect(result).toBe('2024/01/15');
    });

    it('should format with custom string formatter using colon separator', () => {
        const result = formatTime(testDate, 'HH:mm:SS');
        expect(result).toBe('08:05:03');
    });

    it('should format with custom string formatter using dot separator', () => {
        const result = formatTime(testDate, 'YYYY.MM.DD');
        expect(result).toBe('2024.01.15');
    });

    it('should format with custom string formatter using space separator', () => {
        const result = formatTime(testDate, 'YYYY MM DD');
        expect(result).toBe('2024 01 15');
    });

    it('should format with 12-hour format hh', () => {
        const date = new Date(2024, 0, 15, 14, 5, 3);
        const result = formatTime(date, 'hh:mm:SS');
        expect(result).toBe('02:05:03');
    });

    it('should format with 12-hour format h', () => {
        const date = new Date(2024, 0, 15, 14, 5, 3);
        const result = formatTime(date, 'h:mm:SS');
        expect(result).toBe('2:05:03');
    });

    it('should handle midnight (00:00) with 12-hour format', () => {
        const date = new Date(2024, 0, 15, 0, 0, 0);
        const result = formatTime(date, 'hh:mm:SS');
        expect(result).toBe('12:00:00');
    });

    it('should handle noon (12:00) with 12-hour format', () => {
        const date = new Date(2024, 0, 15, 12, 0, 0);
        const result = formatTime(date, 'hh:mm:SS');
        expect(result).toBe('12:00:00');
    });

    it('should format with single digit month (M)', () => {
        const date = new Date(2024, 0, 15, 8, 5, 3);
        const result = formatTime(date, 'YYYY-M-DD');
        expect(result).toBe('2024-1-15');
    });

    it('should format with single digit day (D)', () => {
        const date = new Date(2024, 0, 5, 8, 5, 3);
        const result = formatTime(date, 'YYYY-MM-D');
        expect(result).toBe('2024-01-5');
    });

    it('should format with single digit hour (H)', () => {
        const date = new Date(2024, 0, 15, 8, 5, 3);
        const result = formatTime(date, 'H:mm:SS');
        expect(result).toBe('8:05:03');
    });

    it('should format with single digit minute (m)', () => {
        const date = new Date(2024, 0, 15, 8, 5, 3);
        const result = formatTime(date, 'HH:m:SS');
        expect(result).toBe('08:5:03');
    });

    it('should format with single digit second (S)', () => {
        const date = new Date(2024, 0, 15, 8, 5, 3);
        const result = formatTime(date, 'HH:mm:S');
        expect(result).toBe('08:05:3');
    });

    it('should format with three-part date format', () => {
        const result = formatTime(testDate, 'YYYY-MM-DD');
        expect(result).toBe('2024-01-15');
    });

    it('should format with three-part time format', () => {
        const result = formatTime(testDate, 'HH:mm:SS');
        expect(result).toBe('08:05:03');
    });

    it('should handle leading zeros in time components', () => {
        const date = new Date(2024, 0, 15, 9, 9, 9);
        const result = formatTime(date, 'HH:mm:SS');
        expect(result).toBe('09:09:09');
    });

    it('should handle full date and time with custom format', () => {
        const result = formatTime(testDate, 'YYYY-MM-DD HH:mm:SS');
        expect(result).toBe('2024-01-15 08:05:03');
    });

    it('should format year component (YYYY)', () => {
        const result = formatTime(testDate, 'YYYY');
        expect(result).toBe('2024');
    });

    it('should format month component (MM)', () => {
        const result = formatTime(testDate, 'MM');
        expect(result).toBe('01');
    });

    it('should format date component (DD)', () => {
        const result = formatTime(testDate, 'DD');
        expect(result).toBe('15');
    });

    it('should format hour component (HH)', () => {
        const result = formatTime(testDate, 'HH');
        expect(result).toBe('08');
    });

    it('should format minute component (mm)', () => {
        const result = formatTime(testDate, 'mm');
        expect(result).toBe('05');
    });

    it('should format second component (SS)', () => {
        const result = formatTime(testDate, 'SS');
        expect(result).toBe('03');
    });
});