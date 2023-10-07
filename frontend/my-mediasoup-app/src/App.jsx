import { useEffect, useState } from 'react';
import io from 'socket.io-client';
import { Device } from 'mediasoup-client';

export default function App() {
    const [device, setDevice] = useState(null);
    const [sendTransport, setSendTransport] = useState(null);
    const [canStream, setCanStream] = useState(false);
    const [audioInputDevices, setAudioInputDevices] = useState([]);
    const [selectedAudioInputDevice, setSelectedAudioInputDevice] = useState(null);
    const [isStreaming, setIsStreaming] = useState(false); // Track streaming state

    const [producer, setProducer] = useState(null);
    const [userStream, setUserStream] = useState(null);

    const socket = io('http://localhost:3000', {
        transports: ['websocket'],  // use WebSocket transport
    });

    useEffect(() => {
        const setupMediaSoup = async () => {
            try {
                const response = await fetch('http://localhost:3000/rtp-capabilities');
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                const routerRtpCapabilities = await response.json();
                console.log('routerRtpCapabilities:', routerRtpCapabilities);

                const mediaDevice = new Device();
                await mediaDevice.load({ routerRtpCapabilities });

                setDevice(mediaDevice);

                console.log('Media device:', mediaDevice);

                const transportInfo = await fetch(`http://localhost:3000/create-transport?socketId=${socket.id}`)
                .then(res => res.json());

                const transport = mediaDevice.createSendTransport(transportInfo);

                console.log('Transport:', transport);

                transport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
                    console.log('Transport produce event:', kind, rtpParameters);
                    socket.emit('produce', {
                        transportId: transport.id,
                        kind,
                        rtpParameters
                    }, (error, producerId) => {
                        if (error) {
                            console.error('Failed to produce:', error);
                            errback(error);
                            return;
                        }
                        callback({ id: producerId });
                    });
                });
                

                transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                    socket.emit('connect-transport', {
                        transportId: transport.id,
                        dtlsParameters
                    }, (err) => {
                        if (err) {
                            errback(err);
                            return;
                        }
                        callback();
                    });
                });

                transport.on('connectionstatechange', async (state) => {
                    console.log(`Transport connection state changed to ${state}`);
                    // Handle different states or errors accordingly
                });
                                

                setSendTransport(transport);

                const devices = await navigator.mediaDevices.enumerateDevices();
                const audioInputDevices = devices.filter((device) => device.kind === 'audioinput');
                setAudioInputDevices(audioInputDevices);

            } catch (error) {
                console.error("Mediasoup setup failed:", error);
            }
            setCanStream(true);
        };
        setupMediaSoup();
    }, []);

    const startStreaming = async () => {
        try {
            if (!selectedAudioInputDevice) {
                console.error('Please select an audio input device');
                return;
            }

            const constraints = {
                audio: {
                    deviceId: { exact: selectedAudioInputDevice.deviceId },
                },
                video: false,
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            setUserStream(stream);
            const audioTrack = stream.getAudioTracks()[0];
             

            if (sendTransport) {
                // You can specify the kind as 'audio' here
                const producer = await sendTransport.produce({ track: audioTrack, kind: 'audio' });
                setProducer(producer);
                setIsStreaming(true); // Update streaming state
                console.log('Audio producer:', producer);
            } else {
                console.error('Send transport is not yet ready');
            }
        } catch (error) {
            console.error("Failed to start streaming:", error);
        }
    };

    const stopStreaming = async () => {
        try {
            if (producer) {
                await producer.close();
                setIsStreaming(false);
                socket.emit('stop-streaming');
                setProducer(null);
            } else {
                console.error('Producer is not yet ready');
            }
        } catch (error) {
            console.error("Failed to stop streaming:", error);
        }
    };

    return (
        <div>
            <h1>Mediasoup React App</h1>
            {canStream ? (
                <div>
                    <label>Select Audio Input Device:</label>
                    <select
                        onChange={(e) => setSelectedAudioInputDevice(audioInputDevices[e.target.selectedIndex])}
                    >
                        <option value="">-- Select Device --</option>
                        {audioInputDevices.map((device, index) => (
                            <option key={index} value={device.deviceId}>
                                {device.label}
                            </option>
                        ))}
                    </select>
                    <button onClick={startStreaming} disabled={isStreaming}>Start Streaming</button>
                    <button onClick={stopStreaming} disabled={!isStreaming}>Stop Streaming</button>
                </div>
            ) : (
                <p>Setting up, please wait...</p>
            )}
        </div>
    );
}
