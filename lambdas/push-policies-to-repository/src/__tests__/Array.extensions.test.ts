import '../Array.extensions';

describe('Array.extensions', () => {

    it ('odd/even', () => {
        const arr = Array.from(Array(10).keys());

        const [odd, even] = arr.partition(el => el % 2 === 0);

        expect(odd).toHaveLength(5);
        expect(even).toHaveLength(5);
    })
});