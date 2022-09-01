export { };

declare global {
    interface Array<T> {
        partition(callback: (item: T) => boolean): [T[], T[]];
    }
}

if (!Array.prototype.partition) {
    Array.prototype.partition = function <T>(callback: (item: T) => boolean): [T[], T[]] {
        return this.reduce((acc: [T[], T[]], e: T) => {
            acc[callback(e) ? 0 : 1].push(e);

            return acc;
        }, [[], []]);
    };
}