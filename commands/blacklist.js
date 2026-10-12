const { SlashCommandBuilder } = require('discord.js');
const { getCommandRoles } = require('../utils/guildConfig');
const {
    syncBlacklist,
    handleBlacklistButton
} = require('../utils/blacklistApi');

function hasBlacklistAccess(interaction) {
    return getCommandRoles(interaction.guildId, 'training_officer')
        .some(roleId => interaction.member?.roles?.cache?.has(roleId));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('blacklist')
        .setDescription('Refresh the automated faction blacklist'),

    async execute(interaction) {
        if (!hasBlacklistAccess(interaction)) {
            return interaction.reply({
                content: 'You need the Training Officer or Command role to use `/blacklist`.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });
        try {
            const result = await syncBlacklist(interaction.client, interaction.guildId);
            return interaction.editReply(
                `Blacklist refreshed: **${result.blacklistEventsProcessed}** blacklist events processed; ` +
                `**${result.blacklistEventsPending}** pending; **${result.auditEventsSent}** audit posts sent; ` +
                `**${result.activeEntries}** active entries.`
            );
        } catch (error) {
            console.error('[Blacklist] Manual refresh failed:', error);
            return interaction.editReply(`Could not refresh the blacklist: ${error.message}`);
        }
    },

    async handleButton(interaction) {
        return handleBlacklistButton(interaction);
    }
};
