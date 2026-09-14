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

function buildFireNotice({ toName, rank, reason }) {
	return [
		'```ansi',
		'\u001b[1;31mDisciplinary note\u001b[0m',
		`\u001b[1mCO name:\u001b[0m ${toName}`,
		`\u001b[1mRank:\u001b[0m ${rank}`,
		`\u001b[1mDate:\u001b[0m ${formatDate()}`,
		'',
		'\u001b[1mStatement:\u001b[0m',
		'AUTOMATED: This employee has been removed from the ranks of the S.A. Police Department.',
		'The employee was \u001b[1;31mFired\u001b[0m and is no longer within the ranks of the S.A. Police Department.',
		'',
		'\u001b[1mPERSONAL:\u001b[0m',
		reason,
		'```'
	].join('\n');
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('fire')
		.setDescription('Post a disciplinary firing note in a cadet thread')
		.addStringOption(option => option
			.setName('cadet_name')
			.setDescription('Exact name of the cadet')
			.setAutocomplete(true)
			.setRequired(true))
		.addStringOption(option => option
			.setName('to_name')
			.setDescription('Commanding officer name')
			.setRequired(true))
		.addStringOption(option => option
			.setName('rank')
			.setDescription('Commanding officer rank')
			.setRequired(true))
		.addStringOption(option => option
			.setName('reason')
			.setDescription('Personal reason for the firing')
			.setRequired(true)),

	async execute(interaction) {
		const roleId = getCommandRole(interaction.guildId, 'fire');
		if (!roleId) {
			return interaction.reply({
				content: 'The `/fire` command has not been configured for this server.',
				ephemeral: true
			});
		}

		if (!interaction.member.roles.cache.has(roleId)) {
			return interaction.reply({
				content: 'You do not have the role required to use `/fire`.',
				ephemeral: true
			});
		}

		await interaction.deferReply({ ephemeral: true });

		const targetName = interaction.options.getString('cadet_name').trim().toLowerCase();
		const toName = interaction.options.getString('to_name').trim();
		const rank = interaction.options.getString('rank').trim();
		const reason = interaction.options.getString('reason').trim();
		const state = readState();
		const entry = Object.values(state.processed).find(
			item => typeof item.name === 'string' && item.name.toLowerCase() === targetName
		);

		if (!entry || !entry.threadId) {
			return interaction.editReply(`Could not find a valid forum thread for cadet: **${targetName}**.`);
		}

		try {
			const thread = await interaction.client.channels.fetch(entry.threadId);
			await thread.setName(`FIRED | ${entry.name}`.slice(0, 100));
			await thread.send({
				content: buildFireNotice({ toName, rank, reason })
			});
			await thread.setArchived(true);
			state.processed[entry.messageId] = { messageId: entry.messageId };
			writeState(state);
			return interaction.editReply(`Successfully posted a firing notice for **${entry.name}**.`);
		} catch (error) {
			console.error('Failed to post firing notice:', error);
			return interaction.editReply(`Failed to post firing notice: ${error.message}`);
		}
	},

	async autocomplete(interaction) {
		const roleId = getCommandRole(interaction.guildId, 'fire');
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
