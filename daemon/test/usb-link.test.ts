import assert from 'node:assert/strict';
import test from 'node:test';
import {SerialPortMock} from 'serialport';
import {UsbTransport} from '../src/usb-transport.js';

const MockBinding = SerialPortMock.binding;
type MockPortBinding = Awaited<ReturnType<typeof MockBinding.open>>;
const path = process.platform === 'win32' ? 'COM9' : '/dev/cu.usbmodem9001';
// The preferred port passes the platform's port-name filter on every CI runner.
process.env.AGENT_COMPANION_PORT = path;
const openPort = MockBinding.open.bind(MockBinding);

// A device on the mock port that answers INFO, orientation, state, and upload requests. After
// an upload it restarts, and `silentAfterRestart` makes it stop answering, as a wedged USB link does.
function fakeDevice(options: {silentAfterRestart: boolean; silent?: boolean; stuckDrain?: boolean;
                             board?: string | null; protocol?:number; screenDelay?:number;compactDelay?:number}) {
  MockBinding.reset();
  MockBinding.createPort(path, {echo: false, record: false, vendorId: '303a', productId: '1001'});
  const state = {character: 'copilot', silent: options.silent ?? false, received: 0, uploading: false,
                 board: options.board ?? null, notifications:[] as string[],screenPackets:[] as string[],compactPackets:[] as string[]};
  MockBinding.open = async openOptions => {
    const binding: MockPortBinding = await openPort(openOptions);
    const write = binding.write.bind(binding);
    // Like tcdrain on macOS when the device stops reading its USB port: it never returns.
    const drain = binding.drain.bind(binding);
    binding.drain = () => state.silent && options.stuckDrain ? new Promise<void>(() => undefined) : drain();
    const reply = (line: string): void => { setImmediate(() => binding.isOpen && binding.emitData(`${line}\n`)); };
    binding.write = async (buffer: Buffer) => {
      await write(buffer);
      if (state.silent) return;
      const text = buffer.toString('latin1');
      if (state.uploading) {
        state.received += buffer.length;
        if (state.received < 8) return reply(`UPLOAD_ACK received=${state.received}`);
        state.uploading = false;
        state.character = 'bunny';
        reply('UPLOAD_OK character=bunny stalls=0 resyncs=0 rebooting');
        if (options.silentAfterRestart) state.silent = true;
        else setTimeout(() => reply('READY: character=bunny'), 5);
        return;
      }
      // The BOARD line comes in the same chunk as INFO, as the firmware sends them together.
      if (text === 'i') return reply(`INFO protocol=${options.protocol??12} firmware=0123456789abcdef character=${state.character}`
        + (state.board ? `\nBOARD id=${state.board} variant=standard` : ''));
      if(text.startsWith('~')) {state.compactPackets.push(text);setTimeout(()=>reply('SWITCHER accepted'),options.compactDelay??0);return;}
      if(text.startsWith('+')) {state.notifications.push(text);reply('NOTIFY accepted queued=1');return;}
      if(text.startsWith('>')) {state.screenPackets.push(text);setTimeout(()=>reply('SCREEN accepted'),options.screenDelay??0);return;}
      if (text === 'o') return reply('ORIENTATION_SETTINGS offset_tenths=0');
      if (text === 'u') {
        state.uploading = true;
        state.received = 0;
        return reply('UPLOAD_READY max_bytes=4096 chunk=256');
      }
      const command = /^!(\w+)\n$/.exec(text);
      if (command) reply(`COMMAND accepted=${command[1]}`);
    };
    return binding;
  };
  return state;
}

async function until(ready: () => boolean, timeoutMs = 3000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!ready()) {
    if (Date.now() > end) throw new Error('Timed out waiting for the test condition.');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('after a character upload, the transport reports the new character before the device answers again', async () => {
  fakeDevice({silentAfterRestart: true});
  const usb = new UsbTransport(undefined, undefined, {serial: SerialPortMock, requestTimeoutMs: 50});
  try {
    usb.start();
    await until(() => usb.connected);
    assert.equal(usb.character, 'copilot');
    assert.equal(await usb.installCharacter(Buffer.alloc(8)), 'bunny');
    assert.equal(usb.character, 'bunny');
  } finally {
    await usb.stop();
  }
});

test('a USB port that stops answering is closed after three timeouts in a row', async () => {
  fakeDevice({silentAfterRestart: true});
  const usb = new UsbTransport(undefined, undefined, {serial: SerialPortMock, requestTimeoutMs: 50});
  try {
    usb.start();
    await until(() => usb.connected);
    await usb.installCharacter(Buffer.alloc(8));
    usb.setState('working');
    usb.setState('idle');
    assert.equal(usb.connected, true);
    usb.setState('working');
    await until(() => !usb.connected);
  } finally {
    await usb.stop();
  }
});

test('a device that restarts normally keeps its USB link', async () => {
  fakeDevice({silentAfterRestart: false});
  const usb = new UsbTransport(undefined, undefined, {serial: SerialPortMock, requestTimeoutMs: 50});
  try {
    usb.start();
    await until(() => usb.connected);
    await usb.installCharacter(Buffer.alloc(8));
    for (const state of ['working', 'idle', 'working', 'idle'] as const) usb.setState(state);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(usb.connected, true);
    assert.equal(usb.character, 'bunny');
  } finally {
    await usb.stop();
  }
});

test('an open USB port does not count as connected until the device answers', async () => {
  fakeDevice({silentAfterRestart: false, silent: true});
  let changes = 0;
  const usb = new UsbTransport(() => { changes++; }, undefined, {serial: SerialPortMock, requestTimeoutMs: 100});
  try {
    usb.start();
    const end = Date.now() + 400;
    while (Date.now() < end) {
      assert.equal(usb.connected, false);
      assert.equal(usb.character, null);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    // Only the unanswered-port notice changes; a silent port never reports a connect or disconnect.
    assert.ok(changes <= 1);
  } finally {
    await usb.stop();
  }
});

test('a request to a device that stops reading fails at its timeout and does not crash the service', {timeout: 10_000}, async () => {
  fakeDevice({silentAfterRestart: true, stuckDrain: true});
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', record);
  const usb = new UsbTransport(undefined, undefined, {serial: SerialPortMock, requestTimeoutMs: 50});
  try {
    usb.start();
    await until(() => usb.connected);
    await usb.installCharacter(Buffer.alloc(8));
    for (const state of ['working', 'idle', 'working'] as const) usb.setState(state);
    await until(() => !usb.connected);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', record);
    await usb.stop();
  }
});

test('the USB link reports the board that the device names, and no board for firmware without the line', async () => {
  const device = fakeDevice({silentAfterRestart: false, board: 'waveshare-lcd-154'});
  const usb = new UsbTransport(undefined, undefined, {serial: SerialPortMock, requestTimeoutMs: 50});
  try {
    assert.equal(usb.board, null);
    usb.start();
    await until(() => usb.connected);
    assert.equal(usb.board, 'waveshare-lcd-154');
    // A restart into firmware without a BOARD line, which can't say its board.
    device.board = null;
    await usb.installCharacter(Buffer.alloc(8));
    // The restart clears the board, and the INFO reply after it names none.
    await until(() => usb.character === 'bunny' && usb.board === null);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(usb.board, null);
    assert.equal(usb.connected, true);
  } finally {
    await usb.stop();
  }
  assert.equal(usb.board, null);

  fakeDevice({silentAfterRestart: false});
  const old = new UsbTransport(undefined, undefined, {serial: SerialPortMock, requestTimeoutMs: 50});
  try {
    old.start();
    await until(() => old.connected);
    assert.equal(old.connected, true);
    assert.equal(old.board, null);
  } finally {
    await old.stop();
  }
});

test('an immediate scan reports why a device on USB is not reached', async () => {
  const device = fakeDevice({silentAfterRestart: false, silent: true});
  const usb = new UsbTransport(undefined, undefined, {serial: SerialPortMock, requestTimeoutMs: 50});
  try {
    usb.start();
    const found = await usb.scanNow();
    assert.deepEqual(found.ports.map(port => port.path), [path]);
    assert.equal(usb.connected, false);
    assert.match(found.error ?? '', /Timed out/);
    // A device that starts answering connects on the next immediate scan, which then reports no error.
    device.silent = false;
    assert.equal((await usb.scanNow()).error, null);
    assert.equal(usb.connected, true);
  } finally {
    await usb.stop();
  }
});


test('screen policy coalesces hook bursts during an in-flight USB request',async()=>{
 const device=fakeDevice({silentAfterRestart:false,protocol:15,screenDelay:50});
 const usb=new UsbTransport(undefined,undefined,{serial:SerialPortMock,requestTimeoutMs:500});
 try {
  usb.start();await until(()=>usb.connected);
  usb.setScreenProtection('>1|900|3600|20|0|w|1|60\n');
  await until(()=>device.screenPackets.length===1);
  for(let i=0;i<100;i++)usb.setScreenProtection(`>1|900|3600|20|${100-i}|w|1|60\n`);
  const last='>1|900|3600|20|0|i|1|60\n';usb.setScreenProtection(last);
  await until(()=>device.screenPackets.length===2);
  await new Promise(r=>setTimeout(r,100));
  assert.equal(device.screenPackets.length,2);assert.equal(device.screenPackets[1],last);
 }finally{await usb.stop();}
});
test('older USB firmware receives no unsupported screen command',async()=>{
 const device=fakeDevice({silentAfterRestart:false,protocol:14});
 const usb=new UsbTransport(undefined,undefined,{serial:SerialPortMock,requestTimeoutMs:100});
 try{usb.start();await until(()=>usb.connected);usb.setScreenProtection('>1|900|3600|20|0|i|1|60\n');
 await new Promise(r=>setTimeout(r,30));assert.deepEqual(device.screenPackets,[]);
 }finally{await usb.stop();}
});

test('sound-only USB alerts require protocol 17 and honor cancellation before send',async()=>{
 for(const protocol of [16,17]) {
  const device=fakeDevice({silentAfterRestart:false,protocol});
  const usb=new UsbTransport(undefined,undefined,{serial:SerialPortMock,requestTimeoutMs:300});
  try {
   usb.start();await until(()=>usb.connected);
   usb.notify('+1|complete\n');usb.notify('+2|attention\n',()=>false);
   if(protocol===17)await until(()=>device.notifications.length===1);
   await new Promise(r=>setTimeout(r,30));
   assert.deepEqual(device.notifications,protocol===17?['+1|complete\n']:[]);
  }finally{await usb.stop();}
 }
});

test('compact heartbeats coalesce behind slow USB and expire before transmission',async()=>{
 const state=fakeDevice({silentAfterRestart:false,protocol:18,compactDelay:80,screenDelay:100});
 const usb=new UsbTransport(undefined,undefined,{serial:SerialPortMock,requestTimeoutMs:500});
 const caption=(tick:number,at=Date.now())=>({agent:'Claude',state:'idle' as const,index:1,count:1,project:'p',title:'t',revision:1,
  targets:[{index:1,agent:'claude',state:'i' as const}],desktop:{index:1,state:'c' as const,tick,observedAt:at}});
 try {
  usb.start();await until(()=>usb.connected);
  usb.setCompact(caption(1));await until(()=>state.compactPackets.length===1);
  for(let i=2;i<=30;i++)usb.setCompact(caption(i));
  await until(()=>state.compactPackets.length===2);await new Promise(r=>setTimeout(r,100));
  assert.equal(state.compactPackets.length,2);assert.match(state.compactPackets[1]!,/1:c:30/);
  usb.setScreenProtection('>1|900|3600|20|0|w|1|60\n');await until(()=>state.screenPackets.length===1);
  usb.setCompact(caption(31,Date.now()-3450));
  await until(()=>state.compactPackets.length===3);assert.match(state.compactPackets[2]!,/0:u:31/);
 } finally {await usb.stop();}
});

test('manual switch sound is only sent to protocol 19 firmware',async()=>{
 for(const protocol of [18,19]) {
  const device=fakeDevice({silentAfterRestart:false,protocol});
  const usb=new UsbTransport(undefined,undefined,{serial:SerialPortMock,requestTimeoutMs:300});
  try {
   usb.start();await until(()=>usb.connected);usb.notify('+1|switch\n',()=>true,19);
   if(protocol===19)await until(()=>device.notifications.length===1);
   await new Promise(r=>setTimeout(r,30));
   assert.deepEqual(device.notifications,protocol===19?['+1|switch\n']:[]);
  }finally{await usb.stop();}
 }
});
