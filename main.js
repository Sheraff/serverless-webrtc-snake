// @ts-check

import { getChannel } from './rtc.js'

function start() {
	const canvas = document.querySelector('canvas')
	if (!canvas) {
		throw new Error('Canvas not found')
	}
	initCanvas(canvas)
}

/**
 * @param {HTMLCanvasElement} canvas
 */
function initCanvas(canvas) {
	function onResize() {
		const min = Math.min(window.innerWidth, window.innerHeight)
		canvas.width = min
		canvas.height = min
	}
	window.addEventListener('resize', onResize)
	onResize()
	const ctx = canvas.getContext('2d')
	if (!ctx) {
		throw new Error('Canvas context not found')
	}
	initConnection(ctx)
}

/**
 * @param {CanvasRenderingContext2D} ctx
 */
async function initConnection(ctx) {
	const [chan, selfName, isOwner] = await getChannel()
	const otherName = await new Promise((resolve) => {
		chan.addEventListener('message', (e) => {
			const msg = JSON.parse(e.data)
			if (msg.type === 'name') {
				resolve(msg.data.name)
			}
		}, { once: true })
		chan.send(JSON.stringify({ type: 'name', data: { name: selfName } }))
	})

	console.log({
		selfName,
		otherName,
	})

	if (isOwner) {
		initGame(ctx, chan, selfName, otherName)
	} else {
		receiveGame(ctx, chan)
	}
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {RTCDataChannel} chan
 */
function receiveGame(ctx, chan) {
	const self = new Snake(5, 5)

	const state = {
		/** @type {[number, number]} */
		direction: [0, -1],
		self,
	}

	chan.addEventListener('message', (e) => {
		const msg = JSON.parse(e.data)
		if (msg.type === 'game') {
			ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
			World.draw(ctx, msg.data.world)
			state.self.body = msg.data.world.snakes[1].body
			chan.send(JSON.stringify({ type: 'ack-game' }))
		}
	})

	handleInput(state, (direction) => {
		chan.send(JSON.stringify({ type: 'direction', data: { direction } }))
	})
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {RTCDataChannel} chan
 * @param {string} selfName
 * @param {string} otherName
 */
function initGame(ctx, chan, selfName, otherName) {
	const world = new World(20)
	const self = new Snake(5, 5)
	world.snakes.push(self)
	const other = new Snake(15, 15, 'Iorzqihamziruh')
	world.snakes.push(other)

	const state = {
		/** @type {[number, number]} */
		direction: [0, -1],
		/** @type {[number, number]} */
		otherDirection: [0, -1],
		timeStep: 750,
		self,
		delay: 0,
	}

	handleInput(state)

	let sentAt = 0
	chan.addEventListener('message', (e) => {
		const msg = JSON.parse(e.data)
		if (msg.type === 'direction') {
			state.otherDirection = msg.data.direction
		} else if (msg.type === 'ack-game') {
			state.delay = (performance.now() - sentAt) / 2
		}
	})

	function send() {
		const dump = {
			type: 'game',
			data: {
				world: world.dump(),
			},
		}
		sentAt = performance.now()
		chan.send(JSON.stringify(dump))
	}

	function update() {
		world.update(state)
	}

	function draw() {
		ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
		world.draw(ctx)
	}

	let lastTick = 0
	let drawn = false
	/**
	 * @param {DOMHighResTimeStamp} time
	 */
	function loop(time) {
		requestAnimationFrame(loop)
		if (!lastTick) {
			lastTick = time
			send()
			draw()
			return
		}
		const dt = time - lastTick
		if (!drawn && dt >= state.delay) {
			draw()
		}
		if (dt < state.timeStep) {
			return
		}
		lastTick = time
		update()
		send()
		drawn = false
	}
	requestAnimationFrame(loop)
}

/**
 * @param {object} state
 * @param {[number, number]} state.direction
 * @param {Snake} state.self
 * @param {(dir: [number, number]) => void} [callback]
 */
function handleInput(state, callback) {

	const keyMap = /** @type {const} */({
		ArrowUp: [0, -1],
		ArrowDown: [0, 1],
		ArrowLeft: [-1, 0],
		ArrowRight: [1, 0],
	})

	window.addEventListener('keydown', (e) => {
		if (e.key in keyMap) {
			e.preventDefault()
			const [dx, dy] = keyMap[/** @type {keyof typeof keyMap} */(e.key)]
			const [x, y] = /** @type {[number, number]} */(state.self.body[0])
			const [px, py] = /** @type {[number, number]} */(state.self.body[1])
			if (x + dx === px && y + dy === py) {
				return
			}
			state.direction = [dx, dy]
			callback?.(state.direction)
		}
	})
}


class World {
	/** @type {number} */
	side
	/** @type {Snake[]} */
	snakes
	/** @type {Set<Food>} */
	foods

	/**
	 * @param {number} side
	 */
	constructor(side) {
		this.side = side
		this.snakes = []
		this.foods = new Set()
	}

	dump() {
		return {
			side: this.side,
			snakes: this.snakes.map((s) => ({ body: s.body, color: s.color })),
			foods: [...this.foods].map((f) => ({ x: f.x, y: f.y })),
		}
	}

	/**
	 * @param {object} state
	 * @param {[number, number]} state.direction
	 * @param {[number, number]} state.otherDirection
	 * @param {number} state.timeStep
	 * @param {Snake} state.self
	 */
	update(state) {
		/** @type {Set<Snake>} */
		const growers = new Set()

		for (const food of this.foods) {
			for (const snake of this.snakes) {
				const [dx, dy] = snake === state.self ? state.direction : state.otherDirection
				const [x, y] = /** @type {([number, number])} */(snake.body[0])
				if (food.x === x + dx && food.y === y + dy) {
					growers.add(snake)
					this.foods.delete(food)
					state.timeStep *= 0.95
				}
			}
		}

		for (const snake of this.snakes) {
			const [dx, dy] = snake === state.self ? state.direction : state.otherDirection
			const [x, y] = /** @type {[number, number]} */(snake.body[0])
			let newX = x + dx
			let newY = y + dy
			if (newX < 0) {
				newX = this.side - 1
			} else if (newX >= this.side) {
				newX = 0
			}
			if (newY < 0) {
				newY = this.side - 1
			} else if (newY >= this.side) {
				newY = 0
			}
			snake.body.unshift([newX, newY])
			if (!growers.has(snake)) {
				snake.body.pop()
			}
		}

		const lengthBefore = this.snakes.length
		for (const snake of this.snakes) {
			for (const other of this.snakes) {
				const [sx, sy] = /** @type {[number, number]} */(snake.body[0])
				for (let i = 0; i < other.body.length; i++) {
					const [ox, oy] = /** @type {[number, number]} */(other.body[i])
					if (sx === ox && sy === oy && (snake !== other || i > 0)) {
						this.snakes.splice(this.snakes.indexOf(snake), 1)
						break
					}
				}
			}
		}

		if (lengthBefore !== this.snakes.length) {
			if (lengthBefore === 1) {
				alert('You lost...')
			} else if (this.snakes.length === 1) {
				if (this.snakes[0] === state.self) {
					alert('You won!')
				} else {
					alert('You lost...')
				}
			}
		}

		refeed: while (this.foods.size < this.snakes.length) {
			const x = Math.floor(Math.random() * this.side)
			const y = Math.floor(Math.random() * this.side)
			for (const snake of this.snakes) {
				if (snake.body.some(([bx, by]) => bx === x && by === y)) {
					continue refeed
				}
			}
			this.foods.add(new Food(x, y))
		}
	}

	/**
	 * @param {CanvasRenderingContext2D} ctx 
	 */
	draw(ctx) {
		World.draw(ctx, this)
	}

	/**
	 * @param {CanvasRenderingContext2D} ctx
	 * @param {object} world
	 * @param {number} world.side
	 * @param {{ body: [x: number, y: number][], color: string }[]} world.snakes
	 * @param {{x: number, y: number}[] | Set<{x: number, y: number}>} world.foods
	 */
	static draw(ctx, { side, snakes, foods }) {
		const unitSize = ctx.canvas.width / side
		ctx.strokeStyle = 'black'
		ctx.strokeRect(0, 0, ctx.canvas.width, ctx.canvas.height)
		for (const food of foods) {
			Food.draw(ctx, unitSize, food)
		}
		for (const snake of snakes) {
			Snake.draw(ctx, unitSize, snake)
		}
	}
}

class Snake {
	/** @type {[x: number, y: number][]} */
	body

	/** @type {string} */
	id

	/** @type {string} */
	color

	/**
	 * @param {number} x
	 * @param {number} y
	 * @param {?string} id
	 * @param {?string} color
	 */
	constructor(x, y, id = null, color = null) {
		this.body = [[x, y], [x, y + 1], [x, y + 2]]

		if (id) {
			this.id = id
		} else {
			const rand = Math.round(Math.random() * 1_000_000_000 + Date.now())
			this.id = rand.toString(36)
		}

		if (color) {
			this.color = color
		} else {
			const index = Math.random() * LIST_OF_DISTINCT_COLORS.length | 0
			this.color = /** @type {string} */(LIST_OF_DISTINCT_COLORS[index])
		}
	}

	/**
	 * @param {CanvasRenderingContext2D} ctx
	 * @param {number} unitSize
	 */
	draw(ctx, unitSize) {
		Snake.draw(ctx, unitSize, this)
	}

	/**
	 * @param {CanvasRenderingContext2D} ctx
	 * @param {number} unitSize
	 * @param {{ body: [x: number, y: number][], color: string }} snake
	 */
	static draw(ctx, unitSize, { body, color }) {
		ctx.fillStyle = color
		for (const [x, y] of body) {
			ctx.fillRect(x * unitSize, y * unitSize, unitSize, unitSize)
		}
	}
}

class Food {
	/** @type {number} */
	x
	/** @type {number} */
	y

	/**
	 * @param {number} x
	 * @param {number} y
	 */
	constructor(x, y) {
		this.x = x
		this.y = y
	}

	/**
	 * @param {CanvasRenderingContext2D} ctx
	 * @param {number} unitSize
	 */
	draw(ctx, unitSize) {
		Food.draw(ctx, unitSize, this)
	}

	/**
	 * @param {CanvasRenderingContext2D} ctx
	 * @param {number} unitSize
	 * @param {{x: number, y: number}} food
	 */
	static draw(ctx, unitSize, { x, y }) {
		ctx.fillStyle = 'red'
		ctx.fillRect(x * unitSize, y * unitSize, unitSize, unitSize)
	}
}

const LIST_OF_DISTINCT_COLORS = [
	'#e6194b',
	'#3cb44b',
	'#ffe119',
	'#4363d8',
	'#f58231',
	'#911eb4',
	'#46f0f0',
	'#f032e6',
]

start()