// @ts-check

export async function getChannel() {
	const peerData = getPeerData()
	const chan = peerData
		? await connectToPeer(peerData)
		: await createPeer()
	return chan
}

/**
 * @returns {RTCSessionDescription | null}
 */
function getPeerData() {
	const search = window.location.search
	if (!search) {
		return null
	}
	const params = new URLSearchParams(search)
	const peerData = params.get('peer')
	if (!peerData) {
		return null
	}
	return JSON.parse(atob(peerData))
}

/**
 * @param {RTCSessionDescription} description
 */
async function connectToPeer(description) {
	const dialog = /** @type {HTMLDialogElement} */(document.getElementById('join'))
	dialog.showModal()
	const nameField = /** @type {HTMLInputElement} */(dialog.querySelector('input[name=name]'))
	const startButton = /** @type {HTMLButtonElement} */(dialog.querySelector('button[type=submit]'))
	const ownerName = /** @type {HTMLParagraphElement} */(dialog.querySelector('#room-owner'))
	const initController = new AbortController()

	const peer = new RTCPeerConnection()

	peer.setRemoteDescription(description)
	peer.createAnswer().then(answer => {
		peer.setLocalDescription(answer)
		const key = btoa(JSON.stringify(answer))

		const keyField = /** @type {HTMLInputElement} */(dialog.querySelector('input[readonly]'))
		const copyButton = /** @type {HTMLButtonElement} */(dialog.querySelector('#copy'))
		keyField.value = key
		copyButton.addEventListener('click', () => {
			navigator.clipboard.writeText(key)
		}, { signal: initController.signal })
	})

	/** @type {RTCDataChannel} */
	const chan = await new Promise((resolve) => {
		peer.addEventListener('datachannel', (e) => {
			const chan = e.channel
			if (chan.label !== "snake") {
				console.error('Unexpected channel', chan)
				return
			}

			chan.send(JSON.stringify({ type: 'ack' }))

			chan.addEventListener('message', (e) => {
				const msg = JSON.parse(e.data)
				if (msg.type === 'publish-name') {
					ownerName.textContent = msg.data.name || 'Anonymous'
				}
				if (msg.type === 'ready') {
					resolve(chan)
				}
			}, { signal: initController.signal })

			const onName = () => chan.send(JSON.stringify({ type: 'publish-name', data: { name: nameField.value } }))
			nameField.addEventListener('input', onName, { signal: initController.signal })
			if (nameField.value) {
				onName()
			}

			startButton.disabled = false
			startButton.addEventListener('click', (e) => {
				e.preventDefault()
				startButton.textContent = "Waiting..."
				startButton.disabled = true
				chan.send(JSON.stringify({ type: 'ready' }))
			}, { signal: initController.signal })

		}, { signal: initController.signal })
	})

	const name = nameField.value
	dialog.close()
	initController.abort()

	return /** @type {const} */([chan, name, false])
}

async function createPeer() {
	const dialog = /** @type {HTMLDialogElement} */(document.getElementById('host'))
	dialog.showModal()

	const initController = new AbortController()
	const peer = new RTCPeerConnection()

	const candidatesController = new AbortController()
	peer.addEventListener('icecandidate', () => {
		if (!peer.localDescription) return
		const key = btoa(JSON.stringify(peer.localDescription))
		const url = new URL(window.location.href)
		url.searchParams.set('peer', key)

		const roomLink = /** @type {HTMLAnchorElement} */(dialog.querySelector('#room'))
		const copyButton = /** @type {HTMLButtonElement} */(dialog.querySelector('#copy'))
		roomLink.setAttribute('href', url.toString())
		copyButton.addEventListener('click', () => {
			navigator.clipboard.writeText(url.toString())
		}, { signal: initController.signal })
		candidatesController.abort()
	}, { signal: candidatesController.signal })

	peer.addEventListener('iceconnectionstatechange', () => {
		const state = peer.iceConnectionState
		console.log('iceconnectionstatechange', state)
	}, { signal: initController.signal })

	// for some reason I get zero ice candidates if I don't call createDataChannel before createOffer
	const chan = peer.createDataChannel('snake')

	const peerReady = new Promise(resolve => {
		chan.addEventListener('message', e => {
			const data = JSON.parse(e.data)
			if (data.type === 'ready') {
				resolve(null)
			}
		}, { signal: initController.signal })
	})

	peer.createOffer().then(e => {
		console.log('OFFER', e)
		peer.setLocalDescription(e)
	})

	const peerLine = /** @type {HTMLDivElement} */(dialog.querySelector('.peer'))
	await initPeerLine(peerLine, initController.signal, peer, chan)

	const nameInput = /** @type {HTMLInputElement} */(dialog.querySelector('input[name=name]'))
	const onName = () => chan.send(JSON.stringify({ type: 'publish-name', data: { name: nameInput.value } }))
	nameInput.addEventListener('input', onName, { signal: initController.signal })
	onName()

	await peerReady

	const startButton = /** @type {HTMLButtonElement} */(dialog.querySelector('button[type=submit]'))
	startButton.disabled = false
	const selfReady = new Promise(resolve => {
		startButton.addEventListener('click', (e) => {
			e.preventDefault()
			resolve(null)
			chan.send(JSON.stringify({ type: 'ready' }))
		}, { signal: initController.signal })
	})

	await selfReady

	const name = nameInput.value
	dialog.close()
	initController.abort()
	return /** @type {const} */([chan, name, true])
}


/**
 * @param {HTMLDivElement} line
 * @param {AbortSignal} signal
 * @param {RTCPeerConnection} peer
 * @param {RTCDataChannel} chan
 */
function initPeerLine(line, signal, peer, chan) {
	return new Promise((resolve) => {
		const keysInput = /** @type {HTMLInputElement} */(line.querySelector('.peer-name input'))
		const peerName = /** @type {HTMLParagraphElement} */(line.querySelector('.peer-name p'))
		const inviteButton = /** @type {HTMLButtonElement} */(line.querySelector('button'))

		chan.addEventListener('message', e => {
			const data = JSON.parse(e.data)
			if (data.type === 'publish-name') {
				peerName.textContent = data.data.name || "Anonymous"
			}
		}, { signal })

		keysInput.addEventListener('input', () => {
			if (keysInput.value) {
				inviteButton.disabled = false
			} else {
				inviteButton.disabled = true
			}
		}, { signal })

		let invited = false
		inviteButton.addEventListener('click', async () => {
			invited = !invited
			if (!invited) return
			// connect to peer
			keysInput.type = "hidden"
			peerName.textContent = "Loading..."
			inviteButton.disabled = true
			try {
				const data = JSON.parse(atob(keysInput.value))
				await peer.setRemoteDescription(new RTCSessionDescription(data))
				chan.addEventListener('message', e => {
					const data = JSON.parse(e.data)
					if (data.type === 'ack') {
						console.log('ack')
						resolve(null)
						inviteButton.remove()
						if (peerName.textContent === "Loading...") {
							peerName.textContent = "Anonymous"
						}
					}
				}, { signal })
			} catch (e) {
				console.error(e)
				peerName.textContent = "Invalid key"
				keysInput.type = "text"
				invited = false
				inviteButton.disabled = false
			}
		}, { signal })
	})
}