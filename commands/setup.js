const { ChannelType, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const { addRoles, setGuildChannels, setRole } = require('../utils/guildConfig');

const trainingOfficerCommands = [
    'cadets',
    'cto',
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
            .setRequired(false)
            .addChoices(
                { name: 'Training Officer Role', value: 'training_officer' },
                { name: 'Command Role', value: 'command' }
                ))
        .addRoleOption(option => option
            .setName('role')
            .setDescription('The role allowed to use the command')
            .setRequired(false))
        .addRoleOption(option => option
            .setName('role_2')
            .setDescription('Additional Training Officer role'))
        .addRoleOption(option => option
            .setName('role_3')
            .setDescription('Additional Training Officer role'))
        .addRoleOption(option => option
            .setName('role_4')
            .setDescription('Additional Training Officer role'))
        .addRoleOption(option => option
            .setName('role_5')
            .setDescription('Additional Training Officer role'))
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
            .setRequired(false))
        .addChannelOption(option => option
            .setName('blacklist_channel')
            .setDescription('Text channel for blacklist logs')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false))
        .addChannelOption(option => option
            .setName('blacklist_audit_channel')
            .setDescription('Text channel for individual blacklist add/remove audit entries')
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
        const blacklistChannel = interaction.options.getChannel('blacklist_channel');
        const blacklistAuditChannel = interaction.options.getChannel('blacklist_audit_channel');
        const additionalRoles = ['role_2', 'role_3', 'role_4', 'role_5']
            .map(optionName => interaction.options.getRole(optionName))
            .filter(Boolean);

        if (roleType !== 'training_officer' && additionalRoles.length > 0) {
            return interaction.reply({
                content: 'Additional roles can only be configured for the Training Officer role type.',
                ephemeral: true
            });
        }

        const configuredRoles = [role, ...additionalRoles].filter(Boolean);
        if (!roleType && configuredRoles.length > 0) {
            return interaction.reply({
                content: 'Select a role type when configuring roles.',
                ephemeral: true
            });
        }

        if (roleType === 'training_officer') {
            if (configuredRoles.length > 0) {
                addRoles(interaction.guildId, 'TrainingOfficer', configuredRoles.map(configuredRole => configuredRole.id));
            }
        } else if (roleType === 'command') {
            if (role) {
                setRole(interaction.guildId, 'Command', role.id);
            }
        }

        setGuildChannels(interaction.guildId, {
            forum: forumChannel?.id,
            setrank: setrankChannel?.id,
            inviteLogs: inviteLogsChannel?.id,
            blacklist: blacklistChannel?.id,
            blacklistAudit: blacklistAuditChannel?.id
        });

        const configuredChannels = [
            forumChannel && `forum: <#${forumChannel.id}>`,
            setrankChannel && `setrank: <#${setrankChannel.id}>`,
            inviteLogsChannel && `invite logs: <#${inviteLogsChannel.id}>`,
            blacklistChannel && `blacklist: <#${blacklistChannel.id}>`,
            blacklistAuditChannel && `blacklist audit logs: <#${blacklistAuditChannel.id}>`
        ].filter(Boolean);
        return interaction.reply({
            content: [
                roleType === 'training_officer'
                    ? configuredRoles.length > 0
                        ? `Added ${configuredRoles.map(configuredRole => `**${configuredRole.name}**`).join(', ')} as Training Officer role${configuredRoles.length === 1 ? '' : 's'} for **/${trainingOfficerCommands.join('**, **/') }**.`
                        : 'No Training Officer roles were changed.'
                    : roleType === 'command'
                        ? role
                            ? `Configured the **${role.name}** as the Command role for **/refreshlogs**, **/update**, and **/instructor**.`
                            : 'No Command role was changed.'
                        : 'No role settings were changed.',
                configuredChannels.length > 0
                    ? `Configured channels: ${configuredChannels.join(', ')}.`
                    : 'No channel settings were changed.'
            ].join('\n'),
            ephemeral: true
        });
    }
};