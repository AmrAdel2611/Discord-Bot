const fs = require('fs');
const path = require('path');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    EmbedBuilder,
    MessageFlags,
    SeparatorBuilder,
    TextDisplayBuilder
} = require('discord.js');
const { getCommandRoles, getGuildChannel } = require('./guildConfig');

const statePath = path.join(__dirname, '..', 'blacklist_api_state.json');
const legacyStatePath = path.join(__dirname, '..', 'blacklist_logs.json');
const cachedLogsPath = path.join(__dirname, '..', 'logs.json');
const pageSize = 100;
const entriesPerPage = 10;
const blacklistEventsPerSync = 5;
const logPageRequestDelayMs = 2000;
const forumNameBatchSize = 5;
const forumNameRequestDelayMs = 1000;
const forumNameBatchDelayMs = 5000;
const pendingSyncs = new Map();

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readState() {
    if (!fs.existsSync(statePath)) {
        return { guilds: {} };
    }

    const contents = fs.readFileSync(statePath, 'utf8');
    if (!contents.trim()) {
        return { guilds: {} };
    }

    const state = JSON.parse(contents);
    if (!isRecord(state) || !isRecord(state.guilds)) {
        throw new Error('Blacklist API state must contain a guilds object.');
    }
    return state;
}

function writeState(state) {
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function readLegacyEmbedConfig() {
    if (!fs.existsSync(legacyStatePath)) {
        return { channelId: null, messageId: null };
    }

    const contents = fs.readFileSync(legacyStatePath, 'utf8');
    if (!contents.trim()) {
        return { channelId: null, messageId: null };
    }

    const state = JSON.parse(contents);
    return isRecord(state?.embedConfig)
        ? { ...state.embedConfig }
        : { channelId: null, messageId: null };
}

function getGuildState(state, guildId) {
    if (!state.guilds[guildId]) {
        state.guilds[guildId] = {
            syncCursorId: null,
            activeEntries: [],
            pendingAuditEvents: [],
            pendingAuditSummary: null,
            embedConfig: readLegacyEmbedConfig()
        };
    }

    const guildState = state.guilds[guildId];
    if (!Array.isArray(guildState.activeEntries) || !Array.isArray(guildState.pendingAuditEvents)) {
        throw new Error(`Blacklist API state for guild ${guildId} has invalid entry arrays.`);
    }
    if (guildState.pendingAuditSummary !== null && guildState.pendingAuditSummary !== undefined &&
        !isRecord(guildState.pendingAuditSummary)) {
        throw new Error(`Blacklist API state for guild ${guildId} has an invalid pending audit summary.`);
    }
    if (guildState.pendingAuditSummary === undefined) {
        guildState.pendingAuditSummary = null;
    }
    return guildState;
}

function getApiConfig() {
    const baseUrl = process.env.IMRP_API_URL;
    const accessToken = process.env.IMRP_ACCESS_TOKEN;
    if (!baseUrl) {
        throw new Error('IMRP_API_URL is missing from the environment or .env file');
    }
    if (!accessToken) {
        throw new Error('IMRP_ACCESS_TOKEN is missing from the environment or .env file');
    }
    return { baseUrl: baseUrl.replace(/\/+$/, ''), accessToken };
}

function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function getRetryDelay(response, attempt) {
    const retryValue = response.headers.get('retry-after')
        || response.headers.get('x-ratelimit-reset-after');
    if (retryValue) {
        const seconds = Number(retryValue);
        if (Number.isFinite(seconds)) {
            return Math.max(1000, seconds * 1000);
        }
        const retryDate = Date.parse(retryValue);
        if (Number.isFinite(retryDate)) {
            return Math.max(1000, retryDate - Date.now());
        }
    }
    return Math.min(60000, 5000 * (2 ** attempt));
}

async function fetchApiJson(url) {
    const { accessToken } = getApiConfig();
    for (let attempt = 0; ; attempt += 1) {
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (response.status === 429) {
            if (attempt >= 4) {
                throw new Error(`API rate limit persisted after ${attempt + 1} attempts for ${url}`);
            }
            const delay = getRetryDelay(response, attempt);
            console.warn(`[Blacklist] API rate limited; retrying in ${Math.ceil(delay / 1000)} seconds.`);
            await sleep(delay);
            continue;
        }

        let data;
        try {
            data = await response.json();
        } catch (error) {
            throw new Error(`API returned invalid JSON for ${url}: ${error.message}`);
        }

        if (!response.ok) {
            const apiError = data?.error;
            const details = apiError?.code
                ? ` (${apiError.code}: ${apiError.message})`
                : '';
            throw new Error(`API request failed: ${response.status} ${response.statusText}${details}`);
        }
        return data;
    }
}

function getLogId(log) {
    const id = Number(log?.id);
    if (!Number.isSafeInteger(id) || id < 0) {
        throw new Error('Faction log response contained an invalid log ID.');
    }
    return id;
}

function getBlacklistAction(log) {
    if (log?.type !== 'FACTION_BL') return null;
    const action = log.details?.action;
    if (action !== 'blacklist_add' && action !== 'blacklist_remove') return null;
    return action;
}

function hasTargetPlayerId(log) {
    return log.details?.target_player_id !== undefined && log.details?.target_player_id !== null;
}

function makeActiveEntry(log) {
    return {
        log,
        forumName: null
    };
}

function formatGmtPlusTwoDate(date = new Date()) {
    const localDate = new Date(date.getTime() + 2 * 60 * 60 * 1000);
    const day = String(localDate.getUTCDate()).padStart(2, '0');
    const month = String(localDate.getUTCMonth() + 1).padStart(2, '0');
    return `${day}.${month}.${localDate.getUTCFullYear()}`;
}

function formatGmtPlusTwoTime(date = new Date()) {
    const localDate = new Date(date.getTime() + 2 * 60 * 60 * 1000);
    const hours = String(localDate.getUTCHours()).padStart(2, '0');
    const minutes = String(localDate.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes} GMT+2`;
}

function readCachedLogs() {
    if (!fs.existsSync(cachedLogsPath)) {
        return { logs: [], complete: false, nextPage: 1 };
    }

    const contents = fs.readFileSync(cachedLogsPath, 'utf8');
    if (!contents.trim()) {
        return { logs: [], complete: false, nextPage: 1 };
    }

    const cachedResponse = JSON.parse(contents);
    const cachedPayload = cachedResponse?.data ?? cachedResponse;
    if (!Array.isArray(cachedPayload?.logs)) {
        throw new Error('Cannot initialize the blacklist: logs.json does not contain a logs array.');
    }

    const cacheMetadata = cachedResponse?._cache;
    return {
        logs: cachedPayload.logs,
        complete: typeof cacheMetadata?.complete === 'boolean'
            ? cacheMetadata.complete
            : cachedPayload.logs.length > 0,
        nextPage: Number.isSafeInteger(cacheMetadata?.nextPage) && cacheMetadata.nextPage > 0
            ? cacheMetadata.nextPage
            : 1
    };
}

function writeCachedLogs(logs, complete, nextPage) {
    const temporaryPath = `${cachedLogsPath}.tmp`;
    const contents = `${JSON.stringify({
        data: { logs },
        _cache: { complete, nextPage }
    }, null, 2)}\n`;
    fs.writeFileSync(temporaryPath, contents, 'utf8');
    fs.renameSync(temporaryPath, cachedLogsPath);
}

async function populateCachedLogs(cache) {
    const { baseUrl } = getApiConfig();
    const endpoint = new URL(`${baseUrl}/v2/faction/logs`);
    const logsById = new Map(cache.logs.map(log => [String(getLogId(log)), log]));
    let page = cache.nextPage;

    while (!cache.complete) {
        endpoint.searchParams.set('type', 'TYPE_FACTION_BL');
        endpoint.searchParams.set('limit', String(pageSize));
        endpoint.searchParams.set('page', String(page));
        const response = await fetchApiJson(endpoint);
        const payload = response?.data ?? response;
        if (!Array.isArray(payload?.logs)) {
            throw new Error('Faction logs API response did not contain a logs array.');
        }

        for (const log of payload.logs) {
            logsById.set(String(getLogId(log)), log);
        }

        const logs = [...logsById.values()]
            .sort((left, right) => getLogId(right) - getLogId(left));
        cache.complete = payload.logs.length < pageSize;
        cache.nextPage = page + 1;
        writeCachedLogs(logs, cache.complete, cache.nextPage);
        cache.logs = logs;

        if (!cache.complete) {
            page += 1;
            console.log(`[Blacklist] Cached ${logs.length} faction logs; continuing with API page ${page}.`);
            await sleep(logPageRequestDelayMs);
        }
    }

    return cache.logs;
}

async function fetchFactionLogs(guildState, isBootstrap) {
    if (isBootstrap) {
        const cache = readCachedLogs();
        const logs = cache.complete ? cache.logs : await populateCachedLogs(cache);
        const sortedLogs = [...logs].sort((left, right) => getLogId(right) - getLogId(left));
        const activeEntries = new Map();
        const processedPlayers = new Set();
        let additions = 0;
        let removals = 0;

        for (const log of sortedLogs) {
            const action = getBlacklistAction(log);
            if (!action) continue;

            const targetId = String(log.details.target_player_id);
            if (action === 'blacklist_add') {
                additions += 1;
            } else {
                removals += 1;
            }
            if (!hasTargetPlayerId(log)) {
                console.warn(`[Blacklist] Faction blacklist log ${log.id} is missing target_player_id; skipping active-entry update.`);
                continue;
            }
            if (processedPlayers.has(targetId)) continue;
            processedPlayers.add(targetId);
            if (action === 'blacklist_add') {
                activeEntries.set(targetId, makeActiveEntry(log));
            }
        }

        guildState.activeEntries = [...activeEntries.values()]
            .sort((left, right) => getLogId(right.log) - getLogId(left.log));
        guildState.syncCursorId = sortedLogs.length > 0
            ? sortedLogs.reduce((highestId, log) => Math.max(highestId, getLogId(log)), 0)
            : null;
        guildState.pendingAuditSummary = {
            logsRead: sortedLogs.length,
            blacklistEventsRead: additions + removals,
            additions,
            removals,
            activeEntries: activeEntries.size
        };

        return {
            pageCount: 0,
            isFirstSync: true,
            summary: guildState.pendingAuditSummary
        };
    }

    const { baseUrl } = getApiConfig();
    const endpoint = new URL(`${baseUrl}/v2/faction/logs`);
    const cursor = guildState.syncCursorId === null ? null : Number(guildState.syncCursorId);
    const newAuditEvents = [];
    const activeEntries = new Map(
        guildState.activeEntries.map(entry => [String(entry.log?.details?.target_player_id), entry])
    );
    const pendingEventIds = new Set(
        guildState.pendingAuditEvents.map(log => String(log.id))
    );
    const bootstrapPlayers = new Set();
    const seenLogIds = new Set();
    let logsRead = 0;
    let additions = 0;
    let removals = 0;
    let newestLogId = cursor;
    let page = 0;

    while (true) {
        page += 1;
        endpoint.searchParams.set('type', 'TYPE_FACTION_BL');
        endpoint.searchParams.set('limit', String(pageSize));
        endpoint.searchParams.set('page', String(page));
        const response = await fetchApiJson(endpoint);
        const payload = response?.data ?? response;
        if (!Array.isArray(payload?.logs)) {
            throw new Error('Faction logs API response did not contain a logs array.');
        }
        const logs = payload.logs;
        if (logs.length === 0) break;

        let reachedCursor = false;
        for (const log of logs) {
            const id = getLogId(log);
            if (seenLogIds.has(id)) continue;
            seenLogIds.add(id);
            logsRead += 1;

            if (newestLogId === null || id > newestLogId) {
                newestLogId = id;
            }

            if (cursor !== null && id <= cursor) {
                reachedCursor = true;
                continue;
            }

            const action = getBlacklistAction(log);
            if (!action) continue;

            const targetId = String(log.details.target_player_id);
            if (action === 'blacklist_add') {
                additions += 1;
            } else {
                removals += 1;
            }
            if (!isBootstrap) {
                if (!pendingEventIds.has(String(log.id))) {
                    newAuditEvents.push(log);
                    pendingEventIds.add(String(log.id));
                }
                continue;
            }

            if (!bootstrapPlayers.has(targetId)) {
                bootstrapPlayers.add(targetId);
                if (action === 'blacklist_add') {
                    activeEntries.set(targetId, makeActiveEntry(log));
                } else {
                    activeEntries.delete(targetId);
                }
            }
        }

        if (reachedCursor) break;
        if (logs.length < pageSize) break;
        await sleep(logPageRequestDelayMs);
    }

    const isFirstSync = cursor === null;
    guildState.pendingAuditEvents.push(
        ...newAuditEvents.sort((left, right) => getLogId(left) - getLogId(right))
    );

    guildState.activeEntries = [...activeEntries.values()]
        .sort((left, right) => getLogId(right.log) - getLogId(left.log));
    if (isBootstrap) {
        guildState.pendingAuditSummary = {
            logsRead,
            blacklistEventsRead: additions + removals,
            additions,
            removals,
            activeEntries: activeEntries.size
        };
    }
    guildState.syncCursorId = newestLogId;
    return {
        pageCount: page,
        isFirstSync,
        summary: isFirstSync ? guildState.pendingAuditSummary : null
    };
}

function applyPendingAuditEvents(guildState, maximum = blacklistEventsPerSync) {
    guildState.pendingAuditEvents.sort((left, right) => getLogId(left) - getLogId(right));
    const events = guildState.pendingAuditEvents.slice(0, maximum);
    const activeEntries = new Map(
        guildState.activeEntries.map(entry => [
            String(entry.log?.details?.target_player_id),
            entry
        ])
    );

    for (const log of events) {
        const action = getBlacklistAction(log);
        if (!action) continue;
        if (!hasTargetPlayerId(log)) {
            console.warn(`[Blacklist] Faction blacklist log ${log.id} is missing target_player_id; skipping active-entry update.`);
            continue;
        }
        const targetId = String(log.details.target_player_id);
        if (action === 'blacklist_add') {
            activeEntries.set(targetId, makeActiveEntry(log));
        } else if (action === 'blacklist_remove') {
            activeEntries.delete(targetId);
        }
    }

    guildState.activeEntries = [...activeEntries.values()]
        .sort((left, right) => getLogId(right.log) - getLogId(left.log));
    return events;
}

async function fetchPlayer(playerId) {
    const { baseUrl } = getApiConfig();
    const data = await fetchApiJson(`${baseUrl}/v2/public/players/${encodeURIComponent(playerId)}`);
    const player = data?.data ?? data;
    if (!isRecord(player) || !Object.prototype.hasOwnProperty.call(player, 'forum_name')) {
        throw new Error(`Player API response for ${playerId} did not contain forum_name.`);
    }
    return player;
}

async function updateForumNames(guildState, persistProgress = () => {}) {
    const entries = guildState.activeEntries;
    const needsForumName = entries
        .filter(entry => {
            const forumName = typeof entry.forumName === 'string'
                ? entry.forumName.trim().toLowerCase()
                : '';
            return !forumName || forumName === 'unavailable' || forumName === 'not linked';
        });

    for (let start = 0; start < needsForumName.length; start += forumNameBatchSize) {
        const batch = needsForumName.slice(start, start + forumNameBatchSize);
        for (const [index, entry] of batch.entries()) {
            const playerId = entry.log?.details?.target_player_id;
            try {
                const player = await fetchPlayer(playerId);
                entry.forumName = typeof player.forum_name === 'string' && player.forum_name.trim()
                    ? player.forum_name.trim()
                    : 'Not linked';
            } catch (error) {
                console.error(`[Blacklist] Could not fetch forum name for player ${playerId}:`, error.message);
                entry.forumName = 'Unavailable';
                if (error.message.startsWith('API rate limit persisted')) {
                    persistProgress();
                    throw error;
                }
            }
            persistProgress();

            if (index < batch.length - 1) {
                await sleep(forumNameRequestDelayMs);
            }
        }

        if (start + forumNameBatchSize < needsForumName.length) {
            console.log(
                `[Blacklist] Fetched forum names for ${start + batch.length}/${needsForumName.length}; ` +
                'pausing before the next batch.'
            );
            await sleep(forumNameBatchDelayMs);
        }
    }
}

function buildBlacklistContainer(guildState, requestedPage = 0) {
    const entries = guildState.activeEntries;
    const pageCount = Math.max(1, Math.ceil(entries.length / entriesPerPage));
    const page = Math.max(0, Math.min(requestedPage, pageCount - 1));
    const pageEntries = entries.slice(page * entriesPerPage, (page + 1) * entriesPerPage);
    const container = new ContainerBuilder()
        .setAccentColor(0xE74C3C)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# Blacklisted From Interviews\n\nTotal Blacklisted Users: ${entries.length}`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    if (pageEntries.length === 0) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('No active blacklist entries found.')
        );
    } else {
        for (const [index, entry] of pageEntries.entries()) {
            const details = entry.log.details;
            const username = details.target_player_name || `Player ${details.target_player_id}`;
            const forumName = entry.forumName || 'Unavailable';
            const entryNumber = String(page * entriesPerPage + index + 1).padStart(2, '0');
            container.addActionRowComponents(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`blacklist:details:${details.target_player_id}`)
                        .setLabel(`${entryNumber} | ${username} [${forumName}]`.slice(0, 80))
                        .setStyle(ButtonStyle.Secondary)
                )
            );
        }
    }

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `Last Updated: ${formatGmtPlusTwoDate()}${pageCount > 1 ? ` • Page ${page + 1}/${pageCount}` : ''}`
        )
    );

    if (pageCount > 1) {
        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`blacklist:page:${page - 1}`)
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === 0),
                new ButtonBuilder()
                    .setCustomId(`blacklist:page:${page + 1}`)
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === pageCount - 1)
            )
        );
    }
    return container;
}

async function updateBlacklistMessage(client, guildId, guildState) {
    const channelId = getGuildChannel(guildId, 'blacklist');
    if (!channelId) {
        throw new Error(`No channels.blacklist is configured for guild ${guildId}.`);
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !channel.messages) {
        throw new Error(`Configured blacklist channel ${channelId} is not a text channel.`);
    }

    const container = buildBlacklistContainer(guildState);
    let message = null;
    if (guildState.embedConfig?.channelId === channelId && guildState.embedConfig?.messageId) {
        try {
            message = await channel.messages.fetch(guildState.embedConfig.messageId);
        } catch (error) {
            if (error.code !== 10008) throw error;
        }
    }

    if (message) {
        await message.edit({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
    } else {
        message = await channel.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
    }

    guildState.embedConfig = { channelId, messageId: message.id };
}

function buildAuditEmbed(log) {
    const isAddition = log.details.action === 'blacklist_add';
    const timestamp = Date.parse(log.created_at);
    const date = Number.isFinite(timestamp)
        ? `<t:${Math.floor(timestamp / 1000)}:f>`
        : String(log.created_at || 'Unknown');
    const details = log.details;

    return new EmbedBuilder()
        .setTitle('Blacklist Entry')
        .setColor(isAddition ? 0xE74C3C : 0x2ECC71)
        .addFields(
            { name: 'Date', value: date, inline: true },
            { name: 'Log ID', value: `\`${log.id}\``, inline: true },
            { name: 'Details', value: String(log.message || 'Not provided').slice(0, 1024), inline: false }
        );
}

function buildAuditSummaryEmbed(summary) {
    return new EmbedBuilder()
        .setTitle('Blacklist Sync Summary')
        .setColor(0x3498DB)
        .setDescription('Initial API sync completed.')
        .addFields(
            { name: 'Logs Read', value: String(summary.logsRead), inline: true },
            { name: 'Blacklist Events', value: String(summary.blacklistEventsRead), inline: true },
            { name: 'Added', value: String(summary.additions), inline: true },
            { name: 'Removed', value: String(summary.removals), inline: true },
            { name: 'Currently Active', value: String(summary.activeEntries), inline: true }
        )
        .setTimestamp();
}

async function sendPendingAuditEvents(client, guildId, guildState) {
    if (!guildState.pendingAuditSummary && guildState.pendingAuditEvents.length === 0) return 0;

    const channelId = getGuildChannel(guildId, 'blacklistAudit');
    if (!channelId) {
        throw new Error(`No channels.blacklistAudit is configured for guild ${guildId}.`);
    }
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !channel.send) {
        throw new Error(`Configured blacklist audit channel ${channelId} is not a text channel.`);
    }

    let sent = 0;
    if (guildState.pendingAuditSummary) {
        await channel.send({
            embeds: [buildAuditSummaryEmbed(guildState.pendingAuditSummary)]
        });
        guildState.pendingAuditSummary = null;
        sent += 1;
        writeGuildState(guildId, guildState);
    }

    guildState.pendingAuditEvents.sort((left, right) => getLogId(left) - getLogId(right));
    let sentEvents = 0;
    while (guildState.pendingAuditEvents.length > 0 && sentEvents < blacklistEventsPerSync) {
        const log = guildState.pendingAuditEvents[0];
        await channel.send({ embeds: [buildAuditEmbed(log)] });
        guildState.pendingAuditEvents.shift();
        sent += 1;
        sentEvents += 1;
        writeGuildState(guildId, guildState);
    }
    if (sent > 0) {
        console.log(`[Blacklist] Sent ${sent} audit post(s) for ${guildId} to channel ${channelId}.`);
    }
    return sent;
}

function writeGuildState(guildId, guildState) {
    const state = readState();
    state.guilds[guildId] = guildState;
    writeState(state);
}

async function syncBlacklist(client, guildId) {
    if (pendingSyncs.has(guildId)) return pendingSyncs.get(guildId);

    const sync = syncBlacklistUnlocked(client, guildId)
        .finally(() => pendingSyncs.delete(guildId));
    pendingSyncs.set(guildId, sync);
    return sync;
}

async function syncBlacklistUnlocked(client, guildId) {
    const state = readState();
    const guildState = getGuildState(state, guildId);
    let pageCount = 0;
    let isFirstSync = guildState.syncCursorId === null;
    if (isFirstSync || guildState.pendingAuditEvents.length < blacklistEventsPerSync) {
        const result = await fetchFactionLogs(guildState, isFirstSync);
        pageCount = result.pageCount;
        isFirstSync = result.isFirstSync;
    }
    writeGuildState(guildId, guildState);
    const processedEvents = isFirstSync
        ? []
        : applyPendingAuditEvents(guildState);
    await updateForumNames(guildState, () => writeGuildState(guildId, guildState));
    await updateBlacklistMessage(client, guildId, guildState);
    writeGuildState(guildId, guildState);
    const auditEventsSent = await sendPendingAuditEvents(client, guildId, guildState);
    writeGuildState(guildId, guildState);

    return {
        activeEntries: guildState.activeEntries.length,
        auditEventsSent,
        pagesFetched: pageCount,
        isFirstSync,
        blacklistEventsProcessed: processedEvents.length,
        blacklistEventsPending: guildState.pendingAuditEvents.length
    };
}

function hasBlacklistAccess(interaction) {
    return getCommandRoles(interaction.guildId, 'training_officer')
        .some(roleId => interaction.member?.roles?.cache?.has(roleId));
}

async function handleBlacklistButton(interaction) {
    if (!hasBlacklistAccess(interaction)) {
        return interaction.reply({
            content: 'You need the Training Officer or Command role to view blacklist details.',
            ephemeral: true
        });
    }

    try {
        const [, action, value] = interaction.customId.split(':');
        const state = readState();
        const guildState = getGuildState(state, interaction.guildId);

        if (action === 'page') {
            const page = Number(value);
            if (!Number.isInteger(page)) {
                return interaction.reply({ content: 'That blacklist page is invalid.', ephemeral: true });
            }
            return interaction.update({
                components: [buildBlacklistContainer(guildState, page)],
                flags: MessageFlags.IsComponentsV2
            });
        }

        if (action === 'details') {
            const entry = guildState.activeEntries.find(
                item => String(item.log?.details?.target_player_id) === value
            );
            if (!entry) {
                return interaction.reply({
                    content: 'That blacklist entry is no longer active. Refresh the list and try again.',
                    ephemeral: true
                });
            }

            const playerId = entry.log.details.target_player_id;
            const player = await fetchPlayer(playerId);
            const log = entry.log;
            const timestamp = Date.parse(log.created_at);
            const date = Number.isFinite(timestamp)
                ? `<t:${Math.floor(timestamp / 1000)}:F>`
                : String(log.created_at || 'Unknown');
            const detailFields = Object.entries(log.details).map(([name, value]) => ({
                name: name.replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase()).slice(0, 256),
                value: typeof value === 'string'
                    ? value.slice(0, 1024)
                    : JSON.stringify(value).slice(0, 1024),
                inline: true
            }));
            const embed = new EmbedBuilder()
                .setTitle('Blacklist Entry')
                .setColor(0xE74C3C)
                .setDescription(log.message || 'Active faction blacklist entry')
                .addFields(
                    { name: 'In-game Name', value: String(log.details.target_player_name || 'Unknown'), inline: true },
                    {
                        name: 'Forum Name',
                        value: typeof player.forum_name === 'string' && player.forum_name.trim()
                            ? player.forum_name.trim()
                            : 'Not linked',
                        inline: true
                    },
                    { name: 'Date', value: date, inline: true },
                    { name: 'Log ID', value: String(log.id), inline: true },
                    ...detailFields
                );

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        return interaction.reply({ content: 'That blacklist action is not supported.', ephemeral: true });
    } catch (error) {
        console.error('[Blacklist] Failed to handle entry button:', error);
        const reply = {
            content: `Could not load that blacklist entry: ${error.message}`,
            ephemeral: true
        };
        if (interaction.deferred || interaction.replied) {
            return interaction.followUp(reply);
        }
        return interaction.reply(reply);
    }
}

function nextMidnightGmtPlusTwo(now = new Date()) {
    const offsetMs = 2 * 60 * 60 * 1000;
    const localNow = new Date(now.getTime() + offsetMs);
    return Date.UTC(
        localNow.getUTCFullYear(),
        localNow.getUTCMonth(),
        localNow.getUTCDate() + 1
    ) - offsetMs;
}

function scheduleDailyBlacklistSync(client) {
    const runForConfiguredGuilds = async (syncType) => {
        for (const guild of client.guilds.cache.values()) {
            if (!getGuildChannel(guild.id, 'blacklist')) continue;
            try {
                const result = await syncBlacklist(client, guild.id);
                console.log(
                    `[Blacklist] ${syncType} sync for ${guild.id} at ${formatGmtPlusTwoTime()}: ` +
                    `${result.activeEntries} active entries.`
                );
            } catch (error) {
                console.error(`[Blacklist] ${syncType} sync failed for guild ${guild.id}:`, error);
            }
        }
    };

    runForConfiguredGuilds('Startup').catch(error => {
        console.error('[Blacklist] Startup sync failed:', error);
    });

    const scheduleNextRun = () => {
        const delay = Math.max(0, nextMidnightGmtPlusTwo() - Date.now());
        const timer = setTimeout(async () => {
            try {
                await runForConfiguredGuilds('Daily');
            } finally {
                scheduleNextRun();
            }
        }, delay);
        timer.unref?.();
    };
    scheduleNextRun();
}

module.exports = {
    syncBlacklist,
    handleBlacklistButton,
    scheduleDailyBlacklistSync,
    fetchFactionLogs,
    applyPendingAuditEvents,
    nextMidnightGmtPlusTwo,
    buildBlacklistContainer,
    buildAuditEmbed,
    buildAuditSummaryEmbed,
    updateForumNames
};
