const cadetsCommand = require('../commands/cadets.js');

module.exports = {
    name: 'messageCreate',
    async execute(message) {
        try {
            await cadetsCommand.processInviteMessage(message, message.client);
        } catch (error) {
            console.error('Failed to process invite log:', error.message);
        }
    }
};