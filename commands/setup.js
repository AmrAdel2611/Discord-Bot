const { ChannelType, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const { setGuildChannels, setRole } = require('../utils/guildConfig');

const trainingOfficerCommands = [
    'cadets',
    'cto',
    'listcadets',
    'fire',
    'reenlist',
    'training',
    'performance'
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Configure the bot roles and channels in this server')
        .addStringOption(option => option
            .setName('role_type')
            .setDescription('The role type to configure')
            .setRequired(true)
            .addChoices(
                { name: 'Training Officer Role', value: 'training_officer' },
                { name: 'Command Role', value: 'command' }
                ))
        .addRoleOption(option => option
            .setName('role')
            .setDescription('The role allowed to use the command')
            .setRequired(true))
        .addChannelOption(option => option
            .setName('forum_channel')
            .setDescription('Forum channel used for cadet records')
            .addChannelTypes(ChannelType.GuildForum)
            .setRequired(false))
        .addChannelOption(option => option
            .setName('setrank_request_channel')
            .setDescription('Text channel for automatic setrank requests')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false))
        .addChannelOption(option => option
            .setName('invite_logs_channel')
            .setDescription('Text channel containing invite logs')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({
                content: 'This command can only be used within a server.',
                ephemeral: true
            });
        }

        if (interaction.user.id !== process.env.BOT_OWNER_ID) {
            return interaction.reply({
                content: 'Only the bot owner can use this command.',
                ephemeral: true
            });
        }

        const roleType = interaction.options.getString('role_type');
        const role = interaction.options.getRole('role');
        const forumChannel = interaction.options.getChannel('forum_channel');
        const setrankChannel = interaction.options.getChannel('setrank_request_channel');
        const inviteLogsChannel = interaction.options.getChannel('invite_logs_channel');

        if (roleType === 'training_officer') {
            setRole(interaction.guildId, 'TrainingOfficer', role.id);
        } else {
            setRole(interaction.guildId, 'Command', role.id);
        }

        setGuildChannels(interaction.guildId, {
            forum: forumChannel?.id,
            setrank: setrankChannel?.id,
            inviteLogs: inviteLogsChannel?.id
        });

        const configuredChannels = [
            forumChannel && `forum: <#${forumChannel.id}>`,
            setrankChannel && `setrank: <#${setrankChannel.id}>`,
            inviteLogsChannel && `invite logs: <#${inviteLogsChannel.id}>`
        ].filter(Boolean);

        return interaction.reply({
            content: [
                roleType === 'training_officer'
                    ? `Configured the **${role.name}** as the Training Officer role for **/${trainingOfficerCommands.join('**, **/') }**.`
                    : `Configured the **${role.name}** as the Command role for **/refreshlogs**, **/update**, and **/instructor**.`,
                configuredChannels.length > 0
                    ? `Configured channels: ${configuredChannels.join(', ')}.`
                    : 'No channel settings were changed.'
            ].join('\n'),
            ephemeral: true
        });
    }
};