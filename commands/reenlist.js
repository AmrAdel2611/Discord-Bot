const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder } = require('discord.js');

const { getCommandRole } = require('../utils/guildConfig');

const statePath = path.join(__dirname, '..', 'invite_logs.json');

function readState() {
    if (!fs.existsSync(statePath)) {
        return { processed: {} };
    }

    try {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        return {
            ...state,
            processed: state && typeof state.processed === 'object' ? state.processed : {}
        };
    } catch (error) {
        console.error('Failed to read invite log state:', error.message);
        return { processed: {} };
    }
}

function writeState(state) {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function formatDate() {
    const now = new Date();
    return `${String(now.getUTCDate()).padStart(2, '0')}.${String(now.getUTCMonth() + 1).padStart(2, '0')}.${now.getUTCFullYear()}`;
}

function buildReenlistNotice(reenlistmentRank) {
    return [
        '```ansi',
        '\u001b[1;33mRecord Notice\u001b[0m',
        `\u001b[1mDate:\u001b[0m ${formatDate()}`,
        '',
        '\u001b[1mThe results of the performance review:\u001b[0m',
        'AUTOMATED: A SAPD Supervisor posted a note on the officer\'s personnel record.',
        '',
        '\u001b[1mPERSONAL:\u001b[0m',
        `Reenlisted as a ${reenlistmentRank}`,
        '```'
    ].join('\n');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reenlist')
        .setDescription('Post a reenlistment note in a cadet thread')
        .addStringOption(option => option
            .setName('cadet_name')
            .setDescription('Exact name of the cadet')
            .setAutocomplete(true)
            .setRequired(true))
        .addStringOption(option => option
            .setName('reenlistment_rank')
            .setDescription('Rank granted through reenlistment')
            .setRequired(true)),

    async execute(interaction) {
        const roleId = getCommandRole(interaction.guildId, 'reenlist');
        if (!roleId) {
            return interaction.reply({
                content: 'The `/reenlist` command has not been configured for this server.',
                ephemeral: true
            });
        }

        if (!interaction.member.roles.cache.has(roleId)) {
            return interaction.reply({
                content: 'You do not have the role required to use `/reenlist`.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const targetName = interaction.options.getString('cadet_name').trim().toLowerCase();
        const reenlistmentRank = interaction.options.getString('reenlistment_rank').trim();
        const state = readState();
        const entry = Object.values(state.processed).find(
            item => typeof item.name === 'string' && item.name.toLowerCase() === targetName
        );

        if (!entry || !entry.threadId) {
            return interaction.editReply(`Could not find a valid forum thread for cadet: **${targetName}**.`);
        }

        try {
            const thread = await interaction.client.channels.fetch(entry.threadId);
            await thread.setName(`REENLISTMENT | ${entry.name}`.slice(0, 100));
            await thread.send({
                content: buildReenlistNotice(reenlistmentRank)
            });
            await thread.setArchived(true);
            state.processed[entry.messageId] = { messageId: entry.messageId };
            writeState(state);
            return interaction.editReply(`Successfully posted a reenlistment notice for **${entry.name}**.`);
        } catch (error) {
            console.error('Failed to post reenlistment notice:', error);
            return interaction.editReply(`Failed to post reenlistment notice: ${error.message}`);
        }
    },

    async autocomplete(interaction) {
        const roleId = getCommandRole(interaction.guildId, 'reenlist');
        if (!roleId || !interaction.member.roles.cache.has(roleId)) {
            return interaction.respond([]);
        }

        const focusedValue = interaction.options.getFocused().toLowerCase();
        const seenNames = new Set();
        const choices = Object.values(readState().processed)
            .filter(entry => entry.threadId && entry.name)
            .filter(entry => entry.name.toLowerCase().includes(focusedValue))
            .filter(entry => {
                const normalizedName = entry.name.toLowerCase();
                if (seenNames.has(normalizedName)) {
                    return false;
                }
                seenNames.add(normalizedName);
                return true;
            })
            .slice(0, 25)
            .map(entry => ({ name: entry.name, value: entry.name }));

        await interaction.respond(choices);
    }
};
