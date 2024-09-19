import Channel from '@thaunknown/simple-peer/lite.js'
import Events from 'events'
import {Level} from 'level'

export default class Client extends Events {
    constructor(url, hash, opts = {}){
        super()
        this.dev = Boolean(opts.dev)
        this.id = localStorage.getItem('id')
        this.browserOrNot = typeof(window) !== 'undefined'
        this.db = new Level(this.browserOrNot ? 'db' : './db')
        if(!this.id){
            this.id = crypto.randomUUID()
            localStorage.setItem('id', this.id)
        }
        this.simple = opts.simple && typeof(opts.simple) === 'object' && !Array.isArray(opts.simple) ? opts.simple : {}
        this.hash = hash
        this.url = url
        this.channels = new Map()
        this.tracks = new Set()
        this.socket = null
        this.relay = false
        this.temp = new Map()
        this.status = true
        if(opts.auto){
            this.ws()
        }
    }
    begin(){
        this.status = true
        this.ws()
    }
    end(){
        this.status = false
        if(this.socket){
            this.socket.close()
        }
        this.temp.forEach((data) => {
            if(this.channels.has(data.relay)){
                this.channels.get(data.relay).send(JSON.stringify({id: data.id, action: 'abort'}))
            }
        })
        this.temp.clear()
        this.channels.forEach((data) => {
            data.destroy()
        })
        this.channels.clear()
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
                    testChannel.redo = true
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
                    testChannel.redo = true
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
    handleChannel(channel){
        const onConnect = () => {
            if(this.dev){
                console.log('webrtc connect', channel.id)
            }
            clearTimeout(channel.takeOut)
            delete channel.takeOut

            if(this.channels.has(channel.msg.relay)){
                this.channels.get(channel.msg.relay).send({action: 'afterSession', id: channel.msg.id})
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
                    data.send(`trystereo:${JSON.stringify({action: 'add', add: channel.id})}`)
                    channel.send(`trystereo:${JSON.stringify({action: 'add', add: data.id})}`)
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
                    if(!channel.channels.has(data.add)){
                        channel.channels.add(data.add)
                    }
                } else if(data.action === 'sub'){
                    if(!channel.channels.has(data.sub)){
                        channel.channels.add(data.sub)
                    }
                } else if(data.action === 'beforeSearch'){
                    this.beforeSearch(data, channel)
                } else if(data.action === 'afterSearch'){
                    this.afterSearch(data, channel)
                } else if(data.action === 'beforeSession'){
                    this.beforeSession(data, channel)
                } else if(data.action === 'afterSession'){
                    this.afterSession(data, channel)
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
                if(test.startRelay){
                    if(this.channels.has(test.startRelay)){
                        this.channels.get(test.startRelay).send(JSON.stringify({action: 'abort', id: test.id}))
                    }
                }
                if(test.stopRelay){
                    if(this.channels.has(test.stopRelay)){
                        this.channels.get(test.stopRelay).send(JSON.stringify({action: 'abort', id: test.id}))
                    }
                }
                channel.messages.delete(data)
            })
            channel.messages.clear()

            this.channels.forEach((chan) => {
                if(chan.id !== channel.id){
                    chan.send(`trystereo:${JSON.stringify({action: 'sub', sub: channel.id})}`)
                }
            })
            if(this.channels.has(channel.id)){
                this.channels.delete(channel.id)
            }
            if(this.status){
                if(this.channels.size && this.channels.size < 3){
                    this.rtc()
                } else if(this.channels.size){
                    this.ws()
                }
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
            if(chan.id === test.startRelay && test.stopRelay && this.channels.has(test.stopRelay)){
                this.channels.get(test.stopRelay).send(JSON.stringify(obj))
            }
            if(chan.id === test.stopRelay && test.startRelay && this.channels.has(test.startRelay)){
                this.channels.get(test.startRelay).send(JSON.stringify(obj))
            }
            await this.db.del(test.id)
        }
    }
    async beforeSearch(obj, chan){
        if((this.channels.size + this.temp.size) < 6 && !this.channels.has(obj.start)){
            const testChannel = new Channel({...this.simple, initiator: true, trickle: false})
            new Promise((res) => {testChannel.once('signal', res)})
            .then((data) => {
                testChannel.id = obj.start
                testChannel.redo = true
                testChannel.ws = false
                testChannel.msg = {id: obj.id, relay: chan.id, start: obj.start}
                testChannel.channels = new Set()
                testChannel.messages = new Set()
                // if(!this.channels.has(testChannel.id)){
                this.channels.set(testChannel.id, testChannel)
                // }
                // delete obj.start
                chan.send(JSON.stringify({...obj, action: 'afterSearch', data, stop: this.id}))
                testChannel.takeOut = setTimeout(() => {
                    testChannel.redo = false
                    testChannel.destroy()
                }, 60000)
                this.handleChannel(testChannel)
            })
            .catch((err) => {
                testChannel.destroy()
                chan.send(JSON.stringify({...obj, action: 'abort'}))
                console.error(err)
            })
        } else {
            const test = await this.db.get(obj.id)
            if(test){
                obj.action = 'nonmsg'
                chan.send('trystereo:' + JSON.stringify(obj))
                return
            } else {
                if(!chan.messages.has(obj.id)){
                    chan.messages.add(obj.id)
                }
            }
            const base = {startRelay: chan.id, tried: [], id: obj.id, start: obj.start}
            await this.db.put(base.id, base)

            const arr = []
            for(const prop of this.channels.values()){
                arr.push(prop)
            }
            const notTried = arr.filter((data) => {return !base.tried.includes(data.id) && data.id !== base.startRelay})
            // const servers = notTried.filter((data) => {return data.server && data.proto.includes(obj.proto)})
            const i = notTried[Math.floor(Math.random() * notTried.length)]
            if(i){
                obj.action = 'beforeSearch'
                base.tried.push(i.id)
                base.stopRelay = i.id
                await this.db.put(base.id, base)
                i.send('trystereo:' + JSON.stringify(obj))
            } else {
                obj.action = 'nonmsg'
                base.startRelay.send('trystereo:' + JSON.stringify(obj))
                if(base.startRelay.messages.has(base.id)){
                    base.startRelay.messages.delete(base.id)
                }
                await this.db.del(base.id)
            }
        }
    }
    async nonmsg(obj){
        if(this.temp.has(obj.id)){
            const chan = this.temp.get(obj.id)
            const base = chan.msg
            const arr = []
            for(const prop of this.channels.values()){
                arr.push(prop)
            }
            const notTried = arr.filter((data) => {return !base.tried.includes(data.id)})
            // const servers = notTried.filter((data) => {return data.server && data.proto.includes(obj.proto)})
            const i = notTried[Math.floor(Math.random() * notTried.length)]
            if(i){
                obj.action = 'beforeSearch'
                base.tried.push(i.id)
                base.relay = i.id
                i.send('trystereo:' + JSON.stringify(obj))
            } else {
                chan.destroy()
                return
            }
        } else {
            const base = await this.db.get(obj.id)
            if(!base){
                return
            } else {
                if(!this.channels.has(base.startRelay)){
                    await this.db.del(base.id)
                    return
                }
            }
    
            const arr = []
            for(const prop of this.channels.values()){
                arr.push(prop)
            }
            const notTried = arr.filter((data) => {return !base.tried.includes(data.id) && data.id !== base.startRelay})
            // const servers = notTried.filter((data) => {return data.server && data.proto.includes(obj.proto)})
            const i = notTried[Math.floor(Math.random() * notTried.length)]
            if(i){
                obj.action = 'beforeSearch'
                base.tried.push(i.id)
                base.stopRelay = i.id
                await this.db.put(base.id, base)
                i.send('trystereo:' + JSON.stringify(obj))
            } else {
                if(this.channels.has(base.startRelay)){
                    const sendToChannel = this.channels.get(base.startRelay)
                    obj.action = 'nonmsg'
                    sendToChannel.send('trystereo:' + JSON.stringify(obj))
                    if(sendToChannel.messages.has(base.id)){
                        sendToChannel.messages.delete(base.id)
                    }
                }
                await this.db.del(base.id)
            }
        }
    }
    async afterSearch(obj, chan){
        if(this.id === obj.start && this.temp.has(obj.id)){
            const tempChannel = this.temp.get(obj.id)
            if(tempChannel.relay !== chan.id){
                this.temp.delete(tempChannel.id)
                chan.send(JSON.stringify({...obj, action: 'abort'}))
                return
            }
            const testChannel = new Channel({...this.simple, initiator: false, trickle: false})
            new Promise((res) => {testChannel.once('signal', res)})
            .then(async (data) => {
                testChannel.id = obj.stop
                testChannel.msg = tempChannel
                testChannel.msg.stop = obj.stop
                this.temp.delete(tempChannel.id)
                testChannel.redo = true
                testChannel.ws = false
                testChannel.channels = new Set()
                testChannel.messages = new Set()
                if(!this.channels.has(testChannel.id)){
                    this.channels.set(testChannel.id, testChannel)
                }
                delete obj.data
                chan.send(JSON.stringify({...obj, action: 'beforeSession', data}))
                testChannel.takeOut = setTimeout(() => {
                    tempChannel.redo = false
                    testChannel.destroy()
                }, 60000)
                this.handleChannel(testChannel)
            })
            .catch((err) => {
                this.emit('error', err)
                testChannel.destroy()
                this.temp.delete(tempChannel.id)
                chan.send(JSON.stringify({...obj, action: 'abort'}))
                console.error(err)
            })
            testChannel.signal(obj.data)
        } else {
            const test = await this.db.get(obj.id)
            if(test){
                // test.stopRelay === chan.id && test.start === obj.start && this.channels.has(test.startRelay)
                if(test.stopRelay === chan.id && this.channels.has(test.startRelay)){
                    test.stop = obj.stop
                    this.channels.get(test.startRelay).send(JSON.stringify(obj))
                    if(!chan.messages.has(obj.id)){
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
    rtc(){
        const test = {id: crypto.randomUUID(), tried: [], start: this.id}
        this.temp.set(test.id, test)

        const arr = []
        for(const prop of this.channels.values()){
            arr.push(prop)
        }
        const notTried = arr.filter((data) => {return !test.tried.includes(data.id)})
        // const servers = notTried.filter((data) => {return data.server && data.proto.includes(obj.proto)})
        const i = notTried[Math.floor(Math.random() * notTried.length)]
        if(i){
            const obj = {id: test.id, start: test.start, action: 'beforeSearch'}
            test.tried.push(i.id)
            test.relay = i.id
            i.send('trystereo:' + JSON.stringify(obj))
        } else {
            this.temp.delete(test.id)
            return
        }
    }
    async beforeSession(obj, chan){
        if(this.channels.has(obj.start)){
            const testChannel = this.channels.get(obj.start)
            if(testChannel.msg.relay !== chan.id){
                testChannel.destroy()
                chan.send(JSON.stringify({...obj, action: 'abort'}))
                return
            }
            testChannel.signal(obj.data)
            delete obj.data
        } else {
            const test = await this.db.get(obj.id)
            if(test){
                // chan.id === test.startRelay && test.start === obj.start && test.stop === obj.stop && this.channels.has(test.stopRelay)
                if(chan.id === test.startRelay && this.channels.has(test.stopRelay)){
                    this.channels.get(test.stopRelay).send(JSON.stringify(obj))
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
    async afterSession(obj, chan){
        const base = await this.db.get(obj.id)
        if(base){
            if(base.startRelay === chan.id){
                if(this.channels.has(base.stopRelay)){
                    this.channels.get(base.stopRelay).send(JSON.stringify(obj))
                }
            }
            if(base.stopRelay === chan.id){
                if(this.channels.has(base.startRelay)){
                    this.channels.get(base.startRelay).send(JSON.stringify(obj))
                }
            }
            await this.db.del(obj.id)
        } else {
            if(obj.start === this.id){
                if(this.channels.has(obj.stop)){
                    const test = this.channels.get(obj.stop)
                    delete test.msg
                }
            }
            if(obj.stop === this.id){
                if(this.channels.has(obj.start)){
                    const test = this.channels.get(obj.start)
                    delete test.msg
                }
            }
        }
    }
}