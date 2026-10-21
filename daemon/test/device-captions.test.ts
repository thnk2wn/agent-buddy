import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DeviceTransport} from '../src/device-transport.js';
import {UsbTransport} from '../src/usb-transport.js';
import {WifiTransport} from '../src/wifi-transport.js';

test('caption-only changes do not replay animation events on either transport', t => {
  const sent: string[][] = [];
  t.mock.method(UsbTransport.prototype, 'setState', () => {throw new Error('must not resend state');});
  t.mock.method(WifiTransport.prototype, 'setState', () => {throw new Error('must not resend state');});
  t.mock.method(WifiTransport.prototype, 'setUsage', (lines: readonly string[]) => {sent.push([...lines]);});
  const transport = new DeviceTransport();
  transport.setUsage(['On it', 'project']);
  transport.setUsage(['A longer task', 'title']);
  assert.deepEqual(sent, [['On it','project'],['A longer task','title']]);
});
