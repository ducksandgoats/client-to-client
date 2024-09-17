import Channel from '@thaunknown/simple-peer/lite.js'
import Events from 'events'
import {Level} from 'level'

export default class Client extends Events {
    constructor(url, hash, opts){
        super()
        this.dev = Boolean(opts.dev)
        this.id = localStorage.getItem('id')
        this.browserOrNot = typeof(window) !== 'undefined'
        this.db = new Level(this.browserOrNot ? 'db' : './db')
        if(!this.id){
            this.id = crypto.randomBytes(20).toString('hex')
            localStorage.setItem('id', this.id)
        }
        // this.charset = '0123456789AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz'
        this.simple = opts.simple && typeof(opts.simple) === 'object' && !Array.isArray(opts.simple) ? opts.simple : {}
        this.hash = hash
        this.url = url
        // this.num = !opts.num || opts.num < 2 || opts.num > 6 ? 3 : Math.floor(opts.num / 2)
        // this.initOnly = Boolean(opts.initOnly)
        // this.wsOffers = new Map()
        // this.rtcOffers = new Map()
        this.channels = new Map()
        this.tracks = new Set()
        this.socket = null
        this.relay = false
        this.ws()
    }
    quit(){
        // this.wsOffers.forEach((data) => {
        //     data.destroy()
        // })
        // this.rtcOffers.forEach((data) => {
        //     data.destroy()
        // })
        this.channels.forEach((data) => {
            data.destroy()
        })
        // if(this.timerWS){
        //     clearInterval(this.timerWS)
        // }
        if(this.socket){
            this.socket.close()
        }
        Object.keys(this).forEach((data) => {
            if(this[data] !== 'quit'){
                this[data] = null
            }
        })
    }
    initWS(){
        if(this.channels.size < this.max){
            const check = this.max - this.channels.size
            if(this.wsOffers.size < check){
                const test = check - this.wsOffers.size
                for(let i = 0;i < test;i++){
                    const testID = crypto.randomBytes(20).toString('hex')
                    const testChannel = new Channel({...this.simple, initiator: true, trickle: false})
                    testChannel.offer_id = testID
                    testChannel.offer = new Promise((res) => {testChannel.once('signal', res)})
                    testChannel.channels = new Set()
                    this.wsOffers.set(testID, testChannel)
                }
            }
        } else {
            this.wsOffers.forEach((data) => {
                data.destroy((err) => {
                    if(err){
                        this.emit('error', err)
                    }
                })
            })
            this.wsOffers.clear()
        }
    }
    ws(){
        if(this.socket){
            return
        }
        // } else {
        //     delete this.socket
        // }
        this.socket = new WebSocket(`${this.url}?hash=${this.hash}&id=${this.id}&want=${6 - this.channels.size}`)
        const handleOpen = (e) => {
            this.emit('ev', 'socket opened' + e)
        }
        const handleMessage = (e) => {
            let message
            try {
                message = JSON.parse(e.data)
            } catch (error) {
                this.emit('error', error)
                return
            }
            if(message.action === 'relay'){
                if(message.relay){
                    this.url = message.relay
                    this.channels.forEach((data) => {
                        if(!data.connected){
                            data.destroy()
                            this.channels.delete(data.id)
                        }
                    })
                    this.socket.relay = true
                    this.socket.close()
                }
            }
            if(message.action === 'interrupt'){
                if(this.channels.has(message.id)){
                    const testChannel = this.channels.get(message.id)
                    testChannel.destroy()
                    this.channels.delete(message.id)
                }
            }
            if(message.action === 'init'){
                const testChannel = new Channel({...this.simple, initiator: true, trickle: false})
                new Promise((res) => {testChannel.once('signal', res)})
                .then((data) => {
                    testChannel.id = message.res
                    testChannel.ws = true
                    testChannel.channels = new Set()
                    testChannel.messages = new Set()
                    if(!this.channels.has(testChannel.id)){
                        this.channels.set(testChannel.id, testChannel)
                    }
                    this.socket.send(JSON.stringify({...message, action: 'request', request: data}))
                    this.handleChannel(testChannel)
                })
                .catch((err) => {
                    testChannel.destroy()
                    console.error(err)
                })
            }
            if(message.action === 'request'){
                const testChannel = new Channel({...this.simple, initiator: false, trickle: false})
                new Promise((res) => {testChannel.once('signal', res)})
                .then((data) => {
                    testChannel.id = message.req
                    testChannel.ws = true
                    testChannel.channels = new Set()
                    testChannel.messages = new Set()
                    if(!this.channels.has(testChannel.id)){
                        this.channels.set(testChannel.id, testChannel)
                    }
                    delete message.request
                    this.socket.send(JSON.stringify({...message, action: 'response', response: data}))
                    this.handleChannel(testChannel)
                })
                .catch((err) => {
                    testChannel.destroy()
                    console.error(err)
                })
                testChannel.signal(message.request)
            }
            if(message.action === 'response'){
                if(this.channels.has(message.res)){
                    const testChannel = this.channels.get(message.res)
                    testChannel.signal(message.response)
                    delete message.response
                    this.socket.send(JSON.stringify({...message, action: 'proc'}))
                }
            }
        }
        const handleError = (e) => {
            this.emit('error', e)
        }
        const handleClose = (e) => {
            this.emit('ev', 'socket closed' + e)
            handleEvent()
            if(this.socket.relay){
                setTimeout(() => {this.ws()}, 5000)
            }
            delete this.socket
        }
        this.socket.addEventListener('open', handleOpen)
        this.socket.addEventListener('message', handleMessage)
        this.socket.addEventListener('error', handleError)
        this.socket.addEventListener('close', handleClose)
        const handleEvent = () => {
            this.socket.removeEventListener('open', handleOpen)
            this.socket.removeEventListener('message', handleMessage)
            this.socket.removeEventListener('error', handleError)
            this.socket.removeEventListener('close', handleClose)
        }
    }
    rtc(){
        if(this.channels.size >= 6){
            return
        }
        const testChannel = new Channel({...this.simple, initiator: true, trickle: false})
        new Promise((res) => {testChannel.once('signal', res)})
        .then((data) => {
            testChannel.id = crypto.randomBytes(20).toString('hex')
            testChannel.doNotReplace = true
            testChannel.ws = false
            testChannel.msg = {id: testChannel.id, tried: [], req: this.id}
            testChannel.channels = new Set()
            testChannel.messages = new Set()
            testChannel.takeOut = setTimeout(() => {testChannel.destroy()}, 120000)
            if(!this.channels.has(testChannel.id)){
                this.channels.set(testChannel.id, testChannel)
            }
            
            const base = testChannel.msg

            const arr = []
            for(const prop of this.channels.values()){
                arr.push(prop)
            }
            const notTried = arr.filter((data) => {return !base.tried.includes(data.id)})
            // const servers = notTried.filter((data) => {return data.server && data.proto.includes(obj.proto)})
            const i = notTried[Math.floor(Math.random() * notTried.length)]
            if(i){
                const obj = {id: base.id, req: base.req, action: 'request', request: data}
                base.tried.push(i.id)
                base.relay = i.id
                i.send('trystereo:' + JSON.stringify(obj))
            } else {
                testChannel.destroy()
                return
            }
            this.handleChannel(testChannel)
        })
        .catch((err) => {
            testChannel.destroy()
            console.error(err)
        })
    }
    handleChannel(channel){
        const onConnect = () => {
            if(this.dev){
                console.log('webrtc connect', channel.id)
            }
            clearTimeout(channel.takeOut)
            delete channel.takeOut

            if(this.channels.has(channel.msg.relay)){
                this.channels.get(channel.msg.relay).send({action: 'session', id: channel.msg.id})
            }
            delete channel.msg
            // this.dispatchEvent(new CustomEvent('connect', {detail: channel}))
            // if(!this.channels.has(channel.id)){
            //     this.channels.set(channel.id, channel)
            //     this.channels.forEach((data) => {
            //         if(data.id !== channel.id){
            //             data.send('trystereo:add:' + channel.id)
            //             channel.send('trystereo:add:' + data.id)
            //         }
            //     })
            // }
            this.channels.forEach((data) => {
                if(data.id !== channel.id){
                    data.send('trystereo:add:' + channel.id)
                    channel.send('trystereo:add:' + data.id)
                }
            })
            this.emit('connect', channel)
            // channel.emit('connected', channel)
        }
        const onData = (data) => {
            data = new TextDecoder().decode(data)
            if(this.dev){
                console.log('webrtc data', typeof(data), data)
            }
            if(data.startsWith('trystereo:')){
                data = JSON.parse(data.replace('trystereo:', ''))
                if(data.action === 'add'){
                    if(!this.channels.has(data.add)){
                        this.channels.add(data.add)
                    }
                } else if(data.action === 'sub'){
                    if(!this.channels.has(data.sub)){
                        this.channels.add(data.sub)
                    }
                } else if(data.action === 'request'){
                    this.relay(data, channel)
                } else if(data.action === 'response'){
                    this.organize(data, channel)
                } else if(data.action === 'session'){
                    this.session(data, channel)
                } else if(data.action === 'nonmsg'){
                    this.nonmsg(data)
                } else if(data.action === 'abort'){
                    this.abortion(data, channel)
                } else {
                    this.emit('error', new Error('data is invalid'))
                }
            } else {
                channel.emit('message', data)
            }
        }
        // const onStream = (stream) => {
        //     this.dispatchEvent(new CustomEvent('error', {detail: {id: channel.id, ev: stream}}))
        // }
        // const onTrack = (track, stream) => {
        //     this.dispatchEvent(new CustomEvent('error', {detail: {id: channel.id, ev: {track, stream}}}))
        // }
        const onError = (err) => {
            if(this.dev){
                console.error('webrtc error', err)
            }
            err.id = channel.id
            this.emit('error', err)
        }
        const onClose = () => {
            if(this.dev){
                console.log('webrtc data', channel.id)
            }
            // this.dispatchEvent(new CustomEvent('close', {detail: channel}))
            onHandle()

            channel.messages.forEach(async (data) => {
                const test = await this.db.get(data)
                if(test.reqrelay){
                    if(this.channels.has(test.reqrelay)){
                        this.channels.get(test.reqrelay).send(JSON.stringify({action: 'abort', id: test.id}))
                    }
                }
                if(test.resrelay){
                    if(this.channels.has(test.resrelay)){
                        this.channels.get(test.resrelay).send(JSON.stringify({action: 'abort', id: test.id}))
                    }
                }
                channel.messages.delete(data)
            })
            channel.messages.clear()

            this.channels.forEach((chan) => {
                if(chan.id !== channel.id){
                    chan.send('trystereo:sub:' + channel.id)
                }
            })
            if(this.channels.has(channel.id)){
                this.channels.delete(channel.id)
            }
            if(this.channels.size){
                if(channel.ws){
                    this.rtc()
                }
            } else {
                this.ws()
            }
            this.emit('disconnect', channel)
            // channel.emit('disconnected', channel)
        }
        const onHandle = () => {
            channel.off('connect', onConnect)
            channel.off('data', onData)
            // channel.off('stream', onStream)
            // channel.off('track', onTrack)
            channel.off('error', onError)
            channel.off('close', onClose)
        }
        channel.on('connect', onConnect)
        channel.on('data', onData)
        channel.on('error', onError)
        channel.on('close', onClose)
    }
    onSend(data, id = null){
        if(id){
            if(this.channels.has(id)){
                const test = this.channels.get(id)
                if(test.connected){
                    test.send(data)
                }
            }
        } else {
            this.channels.forEach((prop) => {
                if(prop.connected){
                    prop.send(data)
                }
            })
        }
    }
    onMesh(id, data){
        if(this.channels.has(id)){
            const chans = this.channels.get(id)
            this.channels.forEach((chan) => {
                if(chans.id !== chan.id){
                    if(!chan.channels.has(chans.id)){
                        const test = chans.channels.intersection(chan.channels)
                        if(test.size){
                            let i = true
                            for(const prop of test.values()){
                                if(this.id > prop){
                                    i = false
                                    break
                                }
                            }
                            if(i){
                                chan.send(data)
                            }
                        } else {
                            chan.send(data)
                        }
                    }
                }
            })
        }
    }
    async abortion(obj, chan){
        const test = await this.db.get(obj.id)
        if(test){
            if(chan.id === test.reqrelay && test.resrelay && this.channels.has(test.resrelay)){
                this.channels.get(test.resrelay).send(JSON.stringify(obj))
            }
            if(chan.id === test.resrelay && test.reqrelay && this.channels.has(test.reqrelay)){
                this.channels.get(test.reqrelay).send(JSON.stringify(obj))
            }
            await this.db.del(test.id)
        }
    }
    async relay(obj, chan){
        if(!this.channels.has(obj.req) && this.channels.size < 6){
            const testChannel = new Channel({...this.simple, initiator: false, trickle: false})
            new Promise((res) => {testChannel.once('signal', res)})
            .then(async (data) => {
                testChannel.id = obj.req
                testChannel.doNotReplace = true
                testChannel.ws = false
                testChannel.msg = {id: obj.id, relay: chan.id}
                testChannel.channels = new Set()
                testChannel.messages = new Set()
                if(!this.channels.has(testChannel.id)){
                    this.channels.set(testChannel.id, testChannel)
                }
                delete obj.request
                this.socket.send(JSON.stringify({...obj, action: 'response', response: data, res: this.id}))
                testChannel.takeOut = setTimeout(() => {testChannel.destroy()}, 60000)
                this.handleChannel(testChannel)
            })
            .catch((err) => {
                testChannel.destroy()
                console.error(err)
            })
            testChannel.signal(obj.request)
        } else {
            const test = await db.get(obj.id)
            if(test){
                obj.action = 'nonmsg'
                chan.send('trystereo:' + JSON.stringify(obj))
                return
            } else {
                if(!chan.messages.has(obj.id)){
                    chan.messages.add(obj.id)
                }
            }
            const base = {reqrelay: chan.id, tried: [], id: obj.id, req: obj.req}
            await db.put(base.id, base)

            const arr = []
            for(const prop of this.channels.values()){
                arr.push(prop)
            }
            const notTried = arr.filter((data) => {return !base.tried.includes(data.id) && data.id !== base.reqrelay})
            // const servers = notTried.filter((data) => {return data.server && data.proto.includes(obj.proto)})
            const i = notTried[Math.floor(Math.random() * notTried.length)]
            if(i){
                obj.action = 'request'
                base.tried.push(i.id)
                await db.put(base.id, base)
                i.send('trystereo:' + JSON.stringify(obj))
            } else {
                if(this.channels.has(base.reqrelay)){
                    const sendToChannel = this.channels.get(base.reqrelay)
                    obj.action = 'nonmsg'
                    sendToChannel.send('trystereo:' + JSON.stringify(obj))
                    if(sendToChannel.messages.has(base.id)){
                        sendToChannel.messages.delete(base.id)
                    }
                }
                await db.del(base.id)
            }
        }
    }
    async nonmsg(obj){
        if(this.channels.has(obj.id)){
            const chan = this.channels.get(obj.id)
            const base = chan.msg
            const arr = []
            for(const prop of this.channels.values()){
                arr.push(prop)
            }
            const notTried = arr.filter((data) => {return !base.tried.includes(data.id)})
            // const servers = notTried.filter((data) => {return data.server && data.proto.includes(obj.proto)})
            const i = notTried[Math.floor(Math.random() * notTried.length)]
            if(i){
                obj.action = 'request'
                base.tried.push(i.id)
                base.relay = i.id
                i.send('trystereo:' + JSON.stringify(obj))
            } else {
                chan.destroy()
                return
            }
        } else {
            const base = await db.get(obj.id)
            if(!base){
                return
            } else {
                if(!this.channels.has(base.reqrelay)){
                    await this.db.del(base.id)
                    return
                }
            }
    
            const arr = []
            for(const prop of this.channels.values()){
                arr.push(prop)
            }
            const notTried = arr.filter((data) => {return !base.tried.includes(data.id) && data.id !== base.reqrelay})
            // const servers = notTried.filter((data) => {return data.server && data.proto.includes(obj.proto)})
            const i = notTried[Math.floor(Math.random() * notTried.length)]
            if(i){
                obj.action = 'request'
                base.tried.push(i.id)
                await db.put(base.id, base)
                i.send('trystereo:' + JSON.stringify(obj))
            } else {
                if(this.channels.has(base.reqrelay)){
                    const sendToChannel = this.channels.get(base.reqrelay)
                    obj.action = 'nonmsg'
                    sendToChannel.send('trystereo:' + JSON.stringify(obj))
                    if(sendToChannel.messages.has(base.id)){
                        sendToChannel.messages.delete(base.id)
                    }
                }
                await db.del(base.id)
            }
        }
    }
    async organize(obj, chan){
        if(this.channels.has(obj.id)){
            const testChannel = this.channels.get(obj.id)
            if(this.channels.size > 6){
                this.channels.delete(testChannel.id)
                chan.send(JSON.stringify({...obj, action: 'abort'}))
            } else {
                this.channels.delete(testChannel.id)
                testChannel.id = obj.res
                this.channels.set(testChannel.id, testChannel)
                testChannel.signal(obj.response)
                delete obj.response
                chan.send(JSON.stringify({...obj, action: 'session'}))
            }
        } else {
            const test = await db.get(obj.id)
            if(test){
                if(this.channels.has(test.reqrelay)){
                    test.resrelay = chan.id
                    test.res = obj.res
                    this.channels.get(test.reqrelay).send(JSON.stringify(obj))
                    if(chan.messages.has(obj.id)){
                        chan.messages.add(obj.id)
                    }
                    await this.db.put(test.id, test)
                } else {
                    obj.action = 'abort'
                    chan.send('trystereo:' + JSON.stringify(obj))
                    await this.db.del(test.id)
                }
            } else {
                obj.action = 'abort'
                chan.send('trystereo:' + JSON.stringify(obj))
            }
        }
    }
    async session(obj, chan){
        const base = await db.get(obj.id)
        if(base){
            if(base.reqrelay === chan.id){
                if(this.channels.has(base.resrelay)){
                    this.channels.get(base.resrelay).send(JSON.stringify(obj))
                }
            }
            if(base.resrelay === chan.id){
                if(this.channels.has(base.reqrelay)){
                    this.channels.get(base.reqrelay).send(JSON.stringify(obj))
                }
            }
            await this.db.del(obj.id)
        } else {
            if(obj.req === this.id){
                if(this.channels.has(obj.res)){
                    delete this.channels.get(obj.res).msg
                }
            }
            if(obj.res === this.id){
                if(this.channels.has(obj.req)){
                    delete this.channels.get(obj.req).msg
                }
            }
        }
    }
    checkClosing(amount){
        setTimeout(() => {
            if(this.socket.readyState === WebSocket.CLOSED){
                delete this.socket
                this.soc(amount)
            } else {
                setTimeout(() => {this.checkClosing(amount)}, 1500)
            }
        }, 1500)
    }
}