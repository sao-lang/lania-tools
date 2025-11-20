import { CancelTokenSource } from 'axios';

export class CancelTokenManager {
    private cancelTokens: Map<string, CancelTokenSource> = new Map();

    public set(cancelTokenId: string, cancelTokenSource: CancelTokenSource) {
        this.cancelTokens.set(cancelTokenId, cancelTokenSource);
    }

    public has(cancelTokenId: string) {
        return this.cancelTokens.has(cancelTokenId);
    }

    public delete(cancelTokenId: string) {
        if (this.has(cancelTokenId)) {
            this.cancelTokens.delete(cancelTokenId);
        }
    }

    public get(cancelTokenId: string) {
        if (this.has(cancelTokenId)) {
            return this.cancelTokens.get(cancelTokenId);
        }
        return null;
    }

    public clear() {
        this.cancelTokens.clear();
    }

    public cancelById(cancelTokenId: string) {
        const token = this.cancelTokens.get(cancelTokenId);
        if (token) {
            token.cancel(`The request canceled: ${cancelTokenId}`);
            this.cancelTokens.delete(cancelTokenId);
        }
    }

    public cancelAll() {
        this.cancelTokens.forEach((_token, key) => this.cancelById(key));
    }
}
