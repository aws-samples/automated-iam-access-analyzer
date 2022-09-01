import { handler } from '../index';

describe('index.handler', () => {

    const OLD_ENV = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...OLD_ENV };
    });

    afterAll(() => {
        process.env = { ...OLD_ENV };
    });

    it.each([
        [90],
        [undefined]
    ])(`with %i days`,
        async (days) => {
            // arrange

            if (days) {
                process.env.DAYS = `${days}`;
            }
            
            // act
            const actual = await handler();

            // assert
            expect(actual).toHaveProperty('StartTime');
            expect(actual).toHaveProperty('EndTime');
        });
});