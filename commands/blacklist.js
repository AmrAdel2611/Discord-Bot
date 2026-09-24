const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getCommandRole } = require('../utils/guildConfig');
const {
    readBlacklistState,
    addBlacklistUser,
    removeBlackListUser,
    getUserLogs,
    buildContainerListForUser,
    updateLiveBlacklistEmbed } = require('../utils/blacklistLogs.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('blacklist')
        .setDescription('Manage the blacklist')
        .addSubcommand(subcommand => subcommand
            .setName('add')
            .setDescription('Add a user to the blacklist')
            .addStringOption(option => option
                .setName('ig_name')
                .setDescription('In-game instructor name')
                .setRequired(true))
            .addStringOption(option => option
                .setName('interviewer')
                .setDescription('Your username')
                .setRequired(true))
            .addStringOption(option => option
                .setName('reason')
                .setDescription('Reason for blacklisting the user')
                .setRequired(true))
            .addStringOption(option => option
                .setName('length')
                .setDescription('Length of the blacklist')
                .addChoices(
                    { name: '1 day', value: '1d' },
                    { name: '3 days', value: '3d' },
                    { name: '1 week', value: '1w' },
                    { name: '2 weeks', value: '2w' },
                    { name: 'permanent', value: 'Permanent' }
                )
                .setRequired(true))
            .addStringOption(option => option
                .setName('ucp_link')
                .setDescription('UCP Link')
                .setRequired(true)))

        .addSubcommand(subcommand => subcommand
            .setName('remove')
            .setDescription('Remove a user from the blacklist')
            .addStringOption(option => option
                .setName('ig_name')
                .setDescription('In-game instructor name')
                .setAutocomplete(true)
                .setRequired(true)))
        .addSubcommand(subcommand => subcommand
            .setName('search')
            .setDescription('View the logs for a SINGLE blacklisted user')
            .addStringOption(option => option
                .setName('ig_name')
                .setDescription('In-game name')
                .setAutocomplete(true)
                .setRequired(true))),

    async execute(interaction) {
        const roleId = getCommandRole(interaction.guildId, 'command');
        if (!roleId) {
            return interaction.reply({
                content: 'The Command role has not been configured for this server.',
                ephemeral: true
            });
        }

        if (!interaction.member.roles.cache.has(roleId)) {
            return interaction.reply({
                content: 'You do not have the role required to use `/blacklist`.',
                ephemeral: true
            });
        }

        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'add') {
            const igName = interaction.options.getString('ig_name');
            const interviewer = interaction.options.getString('interviewer');
            const reason = interaction.options.getString('reason');
            const length = interaction.options.getString('length');
            const ucpLink = interaction.options.getString('ucp_link');

            const result = await addBlacklistUser(igName, reason, length, ucpLink, interviewer);

            if (!result.added) {
                return interaction.reply({
                    content: `❌ Could not add user to blacklist: ${result.reason}`,
                    ephemeral: true
                });
            }

            // update the live blacklist embed after adding the user
            await updateLiveBlacklistEmbed(interaction);

            return interaction.reply({
                content: `✅ User **${igName}** has been added to the blacklist.`,
                ephemeral: true
            });
        }
        if (subcommand === 'remove') {
            const igName = interaction.options.getString('ig_name');

            const result = await removeBlackListUser(igName);

            if (!result.removed) {
                return interaction.reply({
                    content: `❌ Could not remove user from blacklist: ${result.reason}`,
                    ephemeral: true
                });
            }

            // Update the live blacklist embed after removing the user
            await updateLiveBlacklistEmbed(interaction);

            return interaction.reply({
                content: `✅ User **${igName}** has been removed from the blacklist.`,
                ephemeral: true
            });
        }
        if (subcommand === 'search') {
            const igName = interaction.options.getString('ig_name');

            const userLogs = getUserLogs(igName);

            if (!userLogs.length) {
                return interaction.reply({
                    content: `❌ No logs found for user **${igName}**.`,
                    ephemeral: true
                });
            }

            // Make sure MessageFlags is imported from 'discord.js'
            // and buildContainerListForUser is imported from your blacklist utils

            const container = buildContainerListForUser(igName);

            return interaction.reply({
                components: [container],
                flags: MessageFlags.IsComponentsV2,
                ephemeral: true
            });
        }
    },

    async autocomplete(interaction) {
        // 1. Role permission check (adjust role key if your guilds.json uses 'command')
        const roleId = getCommandRole(interaction.guildId, 'command');
        if (!roleId || !interaction.member.roles.cache.has(roleId)) {
            return interaction.respond([]);
        }

        // 2. Get input and state
        const focusedValue = interaction.options.getFocused().toLowerCase();
        const state = readBlacklistState();
        const users = Array.isArray(state?.bl_users) ? state.bl_users : [];

        // 3. Filter strings matching typed query and cap at 25 results
        const choices = users
            .filter(username => typeof username === 'string' && username.toLowerCase().includes(focusedValue))
            .slice(0, 25)
            .map(username => ({ name: username, value: username }));

        await interaction.respond(choices);
    }
}