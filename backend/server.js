const express = require('express');
const http = require('http');
const mediasoup = require('mediasoup');
const { Server } = require('socket.io');
const { exec } = require('child_process');
const cors = require('cors');
const fs = require('fs'); // Import the 'fs' module

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());

// Directory to store audio files
const audioDirectory = './audio';
fs.mkdirSync(audioDirectory, { recursive: true }); // Ensure the directory exists

// mediasoup configuration...
const mediasoupOptions = {
    worker: { rtcMinPort: 10000, rtcMaxPort: 10100 },
    router: { mediaCodecs: [{ kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 }] },
    webRtcTransport: { listenIps: [{ ip: '127.0.0.1', announcedIp: null }] },
};

// Create a Map to store transports by ID
const transports = new Map();

// Create a Map to store transports by socket.id
const socketTransports = new Map();


let routerRtpCapabilities = null;
let router;

(async () => {
    const worker = await mediasoup.createWorker({
        rtcMinPort: mediasoupOptions.worker.rtcMinPort,
        rtcMaxPort: mediasoupOptions.worker.rtcMaxPort,
    });

    router = await worker.createRouter({ mediaCodecs: mediasoupOptions.router.mediaCodecs });
    // const transport = await router.createWebRtcTransport(mediasoupOptions.webRtcTransport);

    routerRtpCapabilities = await router.rtpCapabilities;

    // TODO: Implement Socket.IO to exchange signaling data between clients and server,
    //       enabling the WebRTC connection to be established for mediasoup.
    io.on('connection', (socket) => {
        let audioStream; // Define audioStream variable here to store audio data
    
        socket.on('connect-transport', async (data, callback) => {
            try {
                // Get the transport using the socket.id
                const transport = socketTransports.get(socket.id);
                if (!transport) {
                    throw new Error('Transport not found for socket id ' + socket.id);
                }
            
                await transport.connect({ dtlsParameters: data.dtlsParameters });
                callback();
            } catch (error) {
                console.error('Transport connection error:', error);
                callback(error);
            }
        });
        
    
        socket.on('produce', async (data, callback) => {
            try {
                const { transportId, kind, rtpParameters } = data;

                console.log(`Trying to produce with transportId: ${transportId}`);
                        
                console.log(`Available transports: ${[...socketTransports.keys()]}`);
                console.log("Socket ID: ", socket.id)
                        
                const transport = socketTransports.get(socket.id);
                console.log("Transport saved: ", transport)
                        
                if (!transport) {
                    throw new Error('Transport not found');
                }
                        
                const producer = await transport.produce({ kind, rtpParameters });
                console.log('Producer created:', producer.id);
    
                if (kind === 'audio') {
                    // Create a PlainTransport and consume the audio.
                    const plainTransport = await router.createPlainTransport({
                        listenIp: { ip: '127.0.0.1', announcedIp: null },
                        enableUdp    : true,
                    });
                    
                    await plainTransport.consume({
                        producerId: producer.id,
                        rtpCapabilities: routerRtpCapabilities, // Use router's RTP capabilities
                    });

                    console.log('PlainTransport created:', plainTransport);
                    
                    // Formulate an FFmpeg command to consume and store the RTP stream.
                    const audioFilePath = `${audioDirectory}/${Date.now()}_audio.opus`;
                    const ffmpegCmd = `ffmpeg -protocol_whitelist file,rtp,udp -i rtp://127.0.0.1:${plainTransport.tuple.localPort} -acodec copy ${audioFilePath}`;
    
                    // Execute FFmpeg command
                    const ffmpeg = exec(ffmpegCmd, (error, stdout, stderr) => {
                        if (error) {
                            console.error(`FFmpeg error: ${error.message}`);
                            return;
                        }
                    });
    
                    // Log FFmpeg output for debugging.
                    ffmpeg.stdout.on('data', (data) => {
                        console.log(`FFmpeg stdout: ${data}`);
                    });
                    ffmpeg.stderr.on('data', (data) => {
                        console.error(`FFmpeg stderr: ${data}`);
                    });
    
                    // Handle FFmpeg process during socket disconnection
                    socket.on('disconnect', () => {
                        ffmpeg.kill('SIGKILL'); // Forcefully stop FFmpeg process
                    });
                }
        
                callback(); // Acknowledge successful production
        
            } catch (error) {
                console.error('Produce error:', error);
                callback(error);
            }
        });
        
    
        socket.on('stop-streaming', async () => {
            try {
                if (audioStream) {
                    // Close the audio stream and reset it
                    audioStream.end();
                    audioStream = null;
                    console.log('Audio stream stopped');
                }
            } catch (error) {
                console.error('Error stopping streaming:', error);
            }
        });
    
        socket.on('disconnect', () => {
            // Handle client disconnection here
            if (audioStream) {
                audioStream.end();
                audioStream = null;
                console.log('Client disconnected - Audio stream stopped');
            }
        });
    });

})();

app.get('/rtp-capabilities', (req, res) => {
    if (!routerRtpCapabilities) {
        return res.status(500).send('Router RtpCapabilities not available');
    }
    res.json(routerRtpCapabilities);
});

app.get('/create-transport', async (req, res) => {
    try {
        if (!router) {
            return res.status(500).send('Router not available');
        }
        // Get the socketId from the query parameter
        const { socketId } = req.query;

        console.log('Creating transport for socket:', socketId);

        const transport = await router.createWebRtcTransport(mediasoupOptions.webRtcTransport);
        if (!transport) {
            console.error('Transport creation failed');
            return res.status(500).send('Transport creation failed');
        }

        // Store the transport by socketId
        socketTransports.set(socketId, transport);

        const transportInfo = {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
        };
        console.log('Transport created:', transportInfo);
        res.json(transportInfo);
    } catch (error) {
        console.error('Error creating WebRtcTransport:', error);
        res.status(500).send(error.toString());
    }
});


server.listen(3000, () => {
    console.log('Server is running on port 3000');
});