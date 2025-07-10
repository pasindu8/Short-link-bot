const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch'); // Make sure you have this dependency

// --- Bot Configuration ---
const BOT_TOKEN = process.env.BOT_TOKEN; // Vercel Environment Variables වලින් කියවයි
// ඔබගේ URL කෙටි කිරීමේ සේවාවේ shorten.php ලිපිනය
const SHORTEN_SERVICE_URL = "http://www.shh.ct.ws/shorten.php"; 

const bot = new TelegramBot(BOT_TOKEN);

// --- Logger (සරල console logs) ---
const logger = {
    info: (...args) => console.log('INFO:', ...args),
    warn: (...args) => console.warn('WARN:', ...args),
    error: (...args) => console.error('ERROR:', ...args),
};

// --- Conversation States (තාවකාලික user state management) ---
const userStates = new Map();

const STATES = {
    NONE: 'none',
    SHORTEN_ASK_URL: 'shorten_ask_url', // URL කෙටි කිරීමේ state එක
};

// --- Bot Commands and State Handlers ---

// Main handler for all messages
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    const currentState = userStates.get(chatId) || STATES.NONE;

    logger.info(`Received message from ${chatId}. Current state: ${currentState}. Text: ${text || '[No Text]'}`);

    // --- Conversation Handlers ---
    if (currentState === STATES.SHORTEN_ASK_URL) {
        if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
            await bot.sendMessage(chatId, 'URL එක කෙටි කරමින් සිටී...');
            logger.info(`Attempting to shorten URL: ${text}`);
            try {
                // POST request එක shorten.php වෙත යවන්න
                const response = await fetch(SHORTEN_SERVICE_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: new URLSearchParams({ long_url: text }).toString()
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
                }

                const htmlResponse = await response.text();
                logger.info(`Received response from shorten.php: ${htmlResponse}`);

                // HTML ප්‍රතිචාරයෙන් කෙටි කළ URL එක extract කරන්න
                // "Short URL: <a href='r.php?c=$short_code'>https://shh.ct.ws/$short_code</a>" වැනි string එකකින් URL එක ගන්න
                const regex = /https:\/\/shh\.ct\.ws\/[a-zA-Z0-9]+(?=["'<])/; // href attribute එකේ හෝ text content එකේ URL එක ගන්න
                const match = htmlResponse.match(regex);

                if (match && match[0]) {
                    const shortUrl = match[0];
                    await bot.sendMessage(chatId, `ඔබගේ කෙටි කළ URL එක: ${shortUrl}`);
                    logger.info(`Successfully shortened URL: ${text} to ${shortUrl}`);
                } else {
                    await bot.sendMessage(chatId, '❌ URL එක කෙටි කිරීමේ දෝෂයක් සිදුවිය. ප්‍රතිචාරය parse කිරීමට නොහැකි විය.');
                    logger.error(`Failed to parse short URL from response: ${htmlResponse}`);
                }

            } catch (e) {
                logger.error(`Error shortening URL ${text}: ${e.message}`);
                await bot.sendMessage(
                    chatId,
                    `❌ URL එක කෙටි කිරීමේ දෝෂයක් සිදුවිය: ${e.message}. කරුණාකර URL එක නිවැරදිදැයි පරීක්ෂා කරන්න.`
                );
            } finally {
                userStates.delete(chatId); // ක්‍රියාවලිය අවසන් වූ පසු state එක reset කරන්න
            }
        } else {
            await bot.sendMessage(chatId, 'කරුණාකර වලංගු URL එකක් ඇතුළත් කරන්න (http:// හෝ https:// වලින් ආරම්භ විය යුතුය).');
        }
    }
    // --- End Conversation Handlers ---

    // --- Command Handlers (when no active conversation state) ---
    if (text && text.startsWith('/')) {
        const command = text.split(' ')[0];
        if (command === '/start') {
            await bot.sendMessage(
                chatId,
                'ආයුබෝවන්! මම ඔබට URL එකක් කෙටි කිරීමට උදව් කරන bot කෙනෙක්. \n\n' +
                'Commands:\n' +
                '/shorten - URL එකක් කෙටි කරන්න.\n' +
                '/cancel - ඕනෑම ක්‍රියාවලියක් අවලංගු කරන්න.'
            );
        } else if (command === '/shorten') {
            userStates.set(chatId, STATES.SHORTEN_ASK_URL);
            await bot.sendMessage(chatId, 'කරුණාකර ඔබට කෙටි කිරීමට අවශ්‍ය **දිගු URL එක** ඇතුළත් කරන්න.');
        } else if (command === '/cancel') {
            userStates.delete(chatId); 
            await bot.sendMessage(chatId, 'ක්‍රියාවලිය අවලංගු කරන ලදී.');
        } else {
            // Unhandled command
            await bot.sendMessage(chatId, "මට තේරෙන්නේ නැහැ. කරුණාකර /start command එක භාවිතා කර ලබා ගත හැකි commands බලන්න.");
        }
    } else if (currentState === STATES.NONE) {
        // Handle unhandled non-command messages when no conversation is active
        await bot.sendMessage(
            chatId,
            "මට තේරෙන්නේ නැහැ. කරුණාකර /start command එක භාවිතා කර ලබා ගත හැකි commands බලන්න."
        );
    }
});


// --- Vercel Serverless Function Entry Point ---
// මෙය Vercel විසින් ඔබේ bot ට webhook update එකක් ලැබුණු විට ක්‍රියාත්මක කරනු ලැබේ.
module.exports = async (req, res) => {
    if (req.method === 'POST') {
        try {
            // Telegram update එක process කරන්න
            await bot.processUpdate(req.body);
            res.status(200).send('OK');
        } catch (error) {
            logger.error('Error while processing update:', error);
            res.status(500).send('Error');
        }
    } else {
        // GET requests සඳහා සරල පණිවිඩයක් යවන්න
        res.status(200).send('Telegram Bot Webhook is running.');
    }
};

logger.info("Bot webhook handler initialized.");
