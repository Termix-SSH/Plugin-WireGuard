export const DUMP = `@@IF:wg0
@@ACTIVE:1
@@ENABLED:1
@@CONF
[Interface]
Address = 10.8.0.1/24
ListenPort = 51820
PrivateKey = SERVERPRIV=
PostUp = iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE

# termix:client phone
[Peer]
PublicKey = PHONEPUB=
PresharedKey = PHONEPSK=
AllowedIPs = 10.8.0.2/32

@@META
endpoint=vpn.example.com:51820
dns=1.1.1.1
allowed=0.0.0.0/0, ::/0
keepalive=25
@@FILES
meta
phone.conf
@@PUB
SERVERPUB=
@@DUMP
priv\tSERVERPUB=\t51820\toff
PHONEPUB=\tpsk\t1.2.3.4:555\t10.8.0.2/32\t1700000000\t100\t200\t25
@@END
`.replace(/\\t/g, "\t");
