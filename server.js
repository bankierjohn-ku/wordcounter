const express = require('express');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const sharp = require('sharp');

const app = express();
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }
});

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

app.use(express.static('public'));

app.post('/analyze', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image uploaded' });
        }

        let imageBuffer = req.file.buffer;
        let mediaType = req.file.mimetype || 'image/jpeg';
        
        let quality = 95;
        let maxWidth = 3000;
        
        while (true) {
            const processedBuffer = await sharp(imageBuffer)
                .resize(maxWidth, null, { 
                    fit: 'inside', 
                    withoutEnlargement: true 
                })
                .jpeg({ quality })
                .toBuffer();
            
            if (processedBuffer.length < 4.5 * 1024 * 1024) {
                imageBuffer = processedBuffer;
                mediaType = 'image/jpeg';
                break;
            }
            
            if (quality > 80) {
                quality -= 5;
            } else if (maxWidth > 1500) {
                maxWidth -= 300;
                quality = 95;
            } else {
                return res.status(400).json({ 
                    error: 'Image too large to process. Please use a smaller image.' 
                });
            }
        }

        const base64Image = imageBuffer.toString('base64');

        const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4000,
            messages: [{
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: mediaType,
                            data: base64Image
                        }
                    },
                    {
                        type: 'text',
                        text: 'You are transcribing handwritten text for word counting purposes. Accuracy is CRITICAL.\n\nTRANSCRIPTION RULES - FOLLOW EXACTLY:\n1. Transcribe ALL words as best as you can read them\n2. Do NOT correct spelling, grammar, or punctuation - write exactly what you see\n3. Make your best educated guess for unclear words - transcribe what the letters look like\n4. ONLY use blanks (___) for words that are completely illegible/unreadable\n5. Blanks should be RARE - use them only when a word is truly impossible to read\n6. Include ALL words, even tiny ones like "a", "the", "I", "it"\n7. Include crossed-out or scribbled-over text (transcribe it as best you can)\n8. When handwriting is messy, transcribe your best interpretation of the letters you see\n9. Preserve all misspellings and grammar errors exactly as written\n\nGuidelines for blanks:\n- For short illegible words (1-3 letters): ___\n- For medium illegible words (4-6 letters): _____\n- For long illegible words (7+ letters): ________\n\nRemember: Most words should be transcribed, even if the handwriting is messy. Blanks are only for truly unreadable text.\n\nProvide your response in this exact format:\n\nTRANSCRIPTION:\n[the full transcribed text with words written as you read them and only truly illegible words as _____]'
                    }
                ]
            }]
        });

        const responseText = message.content[0].text;
        
        const transcriptionMatch = responseText.match(/TRANSCRIPTION:\s*([\s\S]*)/i);
        const transcription = transcriptionMatch ? transcriptionMatch[1].trim() : responseText;
        
        const words = transcription.trim().split(/\s+/).filter(word => word.length > 0);
        const wordCount = words.length;

        res.json({
            wordCount,
            transcription
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ 
            error: 'Failed to process image. Please try again.' 
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
