import dgram from 'dgram';

const socket1 = dgram.createSocket({ type: 'udp4', reuseAddr: true });
const socket2 = dgram.createSocket({ type: 'udp4', reuseAddr: true });

socket1.bind(54329, '0.0.0.0', () => {
    socket1.addMembership('239.255.255.250', '127.0.0.1');
    socket1.on('message', (msg) => console.log('1 received', msg.toString()));
});

socket2.bind(54329, '0.0.0.0', () => {
    socket2.addMembership('239.255.255.250', '127.0.0.1');
    socket2.on('message', (msg) => console.log('2 received', msg.toString()));
    socket2.send('hello', 54329, '239.255.255.250');
});

setTimeout(() => process.exit(), 1000);
