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
                        text: 'You are transcribing handwritten text for word counting purposes. Accuracy is CRITICAL.\n\nTRANSCRIPTION RULES - FOLLOW EXACTLY:\n1. Transcribe words you are reasonably confident about (70%+ confidence)\n2. For words you are less confident about or cannot read clearly, use blanks:\n   - Short unclear words (1-3 letters): ___\n   - Medium unclear words (4-6 letters): _____\n   - Long unclear words (7+ letters): ________\n3. NEVER skip a word - every single word must be either transcribed OR replaced with a blank\n4. Do NOT correct spelling, grammar, or punctuation - write exactly what you see\n5. Include crossed-out or scribbled-over text (transcribe or use blanks)\n6. PRESERVE LINE BREAKS - transcribe line by line exactly as they appear in the image\n7. Keep the same line structure so users can compare each line with the original\n\nRemember:\n- Every word position must have either text or a blank - no skipping\n- Line breaks are crucial for verification\n- Be honest about uncertainty - use blanks when not confident\n\nProvide your response in this exact format:\n\nTRANSCRIPTION:\n[the full transcribed text with line breaks preserved, confident words transcribed, uncertain words as blanks]'
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
