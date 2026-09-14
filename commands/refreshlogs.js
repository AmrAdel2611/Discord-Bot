const { SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const { getCommandRole } = require('../utils/guildConfig');
const { refreshInviteLogs } = require('./cadets');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('refreshlogs')
        .setDescription('Import old invite logs into the cadet forum.'),

    async execute(interaction) {
        const roleId = getCommandRole(interaction.guildId, 'cadets');
        if (!roleId) {
            return interaction.reply({
                content: 'The `/cadets` command has not been configured for this server.',
                ephemeral: true
            });
        }

        if (!interaction.member.roles.cache.has(roleId)) {
            return interaction.reply({
                content: 'You do not have the role required to use `/refreshlogs`.',
                ephemeral: true
            });
        }

        try {
            return await refreshInviteLogs(interaction);
        } catch (error) {
            console.error('Failed to refresh invite logs:', error);
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply(`Failed to refresh invite logs: ${error.message}`);
            }

            return interaction.reply({
                content: `Failed to refresh invite logs: ${error.message}`,
                ephemeral: true
            });
        }
    }
};