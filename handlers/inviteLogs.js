const { processInviteMessage } = require('../utils/cadetRecords');

module.exports = {
    name: 'messageCreate',
    async execute(message) {
        try {
            await processInviteMessage(message, message.client);
        } catch (error) {
            console.error('Failed to process invite log:', error.message);
        }
    }
};