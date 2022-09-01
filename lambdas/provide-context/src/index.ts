export const handler = async () => {
    const days = process.env.DAYS ? parseInt(process.env.DAYS) : 90;
    const endTime = new Date();
    const startTime = new Date();
    startTime.setTime(endTime.getTime() - days * 86400000);

    return {
        EndTime: endTime.toISOString(),
        StartTime: startTime.toISOString()
    };
};