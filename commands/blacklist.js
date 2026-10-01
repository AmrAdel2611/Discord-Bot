const {
    ActionRowBuilder,
    MessageFlags,
    ModalBuilder,
    SlashCommandBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { getCommandRoles } = require('../utils/guildConfig');
const {
    readBlacklistState,
    addBlacklistUser,
    removeBlackListUser,
    getUserLogs,
    buildContainerList,
    buildContainerListForUser,
    updateLiveBlacklistEmbed } = require('../utils/blacklistLogs.js');

function hasBlacklistAccess(interaction) {
    const roleIds = getCommandRoles(interaction.guildId, 'training_officer');
    return roleIds.some(roleId => interaction.member?.roles?.cache?.has(roleId));
}

function buildAddModal(interaction) {
    return new ModalBuilder()
        .setCustomId('blacklist:add:submit')
        .setTitle('Add Blacklist Entry')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('ig_name')
                    .setLabel('In-game name')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(100)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('interviewer')
                    .setLabel('Interviewer')
                    .setStyle(TextInputStyle.Short)
                    .setValue((interaction.member?.displayName || interaction.user.username).slice(0, 100))
                    .setRequired(true)
                    .setMaxLength(100)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('Reason')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(1000)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('length')
                    .setLabel('Duration: 1d, 3d, 1w, 2w, or Permanent')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(20)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('ucp_link')
                    .setLabel('UCP link')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(200)
            )
        );
}

function buildRemoveModal() {
    return new ModalBuilder()
        .setCustomId('blacklist:remove:submit')
        .setTitle('Remove Blacklist Entry')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('ig_name')
                    .setLabel('Exact in-game name')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(100)
            )
        );
}

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
        const roleIds = getCommandRoles(interaction.guildId, 'training_officer');
        if (roleIds.length === 0) {
            return interaction.reply({
                content: 'The Training Officer and Command roles have not been configured for this server.',
                ephemeral: true
            });
        }

        if (!roleIds.some(roleId => interaction.member.roles.cache.has(roleId))) {
            return interaction.reply({
                content: 'You need the Training Officer or Command role to use `/blacklist`.',
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
        const roleIds = getCommandRoles(interaction.guildId, 'training_officer');
        if (!roleIds.some(roleId => interaction.member.roles.cache.has(roleId))) {
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
    },

    async handleButton(interaction) {
        if (!hasBlacklistAccess(interaction)) {
            return interaction.reply({
            content: 'You need the Training Officer or Command role to manage the blacklist.',
                ephemeral: true
            });
        }

        const [, action, pageValue] = interaction.customId.split(':');
        if (action === 'previous' || action === 'next') {
            const currentPage = Number(pageValue);
            if (!Number.isInteger(currentPage)) {
                return interaction.reply({ content: 'That blacklist page is invalid.', ephemeral: true });
            }

            try {
                const state = readBlacklistState();
                const pageSize = 5;
                const pageCount = Math.ceil(state.bl_users.length / pageSize);
                const lastPage = Math.max(0, pageCount - 1);
                const requestedPage = currentPage + (action === 'next' ? 1 : -1);
                const clampedPage = Math.max(0, Math.min(requestedPage, lastPage));
                const pageEntries = state.bl_users.slice(
                    clampedPage * pageSize,
                    (clampedPage + 1) * pageSize
                );
                const safePage = pageEntries.length > 0 || state.bl_users.length === 0
                    ? clampedPage
                    : lastPage;

                return await interaction.update({
                    components: [buildContainerList(state, safePage)],
                    flags: MessageFlags.IsComponentsV2
                });
            } catch (error) {
                console.error('Failed to update blacklist page:', error);
                await interaction.reply({
                    content: 'Could not load that blacklist page. Please try again.',
                    ephemeral: true
                }).catch(() => null);
                return null;
            }
        }

        if (action === 'add') {
            return interaction.showModal(buildAddModal(interaction));
        }

        if (action === 'remove') {
            return interaction.showModal(buildRemoveModal());
        }

        return interaction.reply({ content: 'That blacklist action is not supported.', ephemeral: true });
    },

    async handleModal(interaction) {
        if (!hasBlacklistAccess(interaction)) {
            return interaction.reply({
            content: 'You need the Training Officer or Command role to manage the blacklist.',
                ephemeral: true
            });
        }

        if (interaction.customId === 'blacklist:add:submit') {
            const igName = interaction.fields.getTextInputValue('ig_name').trim();
            const interviewer = interaction.fields.getTextInputValue('interviewer').trim();
            const reason = interaction.fields.getTextInputValue('reason').trim();
            const enteredLength = interaction.fields.getTextInputValue('length').trim();
            const ucpLink = interaction.fields.getTextInputValue('ucp_link').trim();
            const normalizedLength = enteredLength.toLowerCase();
            const length = normalizedLength === 'permanent'
                ? 'Permanent'
                : normalizedLength;

            if (!['1d', '3d', '1w', '2w', 'Permanent'].includes(length)) {
                return interaction.reply({
                    content: 'Duration must be `1d`, `3d`, `1w`, `2w`, or `Permanent`.',
                    ephemeral: true
                });
            }

            const result = await addBlacklistUser(igName, reason, length, ucpLink, interviewer);
            if (!result.added) {
                return interaction.reply({
                    content: `Could not add user to blacklist: ${result.reason}`,
                    ephemeral: true
                });
            }

            await updateLiveBlacklistEmbed(interaction);
            return interaction.reply({
                content: `User **${igName}** has been added to the blacklist.`,
                ephemeral: true
            });
        }

        if (interaction.customId === 'blacklist:remove:submit') {
            const igName = interaction.fields.getTextInputValue('ig_name').trim();
            const result = await removeBlackListUser(igName);
            if (!result.removed) {
                return interaction.reply({
                    content: `Could not remove user from blacklist: ${result.reason}`,
                    ephemeral: true
                });
            }

            await updateLiveBlacklistEmbed(interaction);
            return interaction.reply({
                content: `User **${igName}** has been removed from the blacklist.`,
                ephemeral: true
            });
        }

        return interaction.reply({ content: 'That blacklist form is not supported.', ephemeral: true });
    }
}