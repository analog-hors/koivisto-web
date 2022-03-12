class Engine {
    constructor(engine) {
        this.engine = engine;
    }

    newGame() {
        return new Promise(res => {
            const waitForReadyOk = _ => {
                this.engine.removeMessageListener(waitForReadyOk);
                //Zero clue why this is necessary.  
                setTimeout(() => res(), 500);
            }
            this.engine.addMessageListener(waitForReadyOk);
            this.engine.postMessage("ucinewgame");
            this.engine.postMessage("isready");
        });
    }

    newSearch(thinkTime, initPos, moves, callback) {
        const handler = message => {
            if (message.startsWith("info")) {
                const depth = parseInt(message.match(/(?<= depth )[0-9]+/g)[0]);
                const nodes = parseInt(message.match(/(?<= nodes )[0-9]+/g)[0]);
                const time = parseInt(message.match(/(?<= time )[0-9]+/g)[0]) / 1000;
                const nps = parseInt(message.match(/(?<= nps )[0-9]+/g)[0]);
                const mv = (message.match(/(?<= pv )\w+/g) || ["a1a1"])[0];
                const scoreParts = message.match(/(?<= score )\w+ -?[0-9]+/g)[0];
                const [scoreType, scoreText] = scoreParts.split(" ");
                const score = parseInt(scoreText, 10);
                const formattedScore = scoreType == "cp"
                    ? (score / 100).toFixed(2)
                    : (score < 0 ? `-M${-score}` : `M${score}`);
                callback({
                    type: "info",
                    value: formattedScore,
                    depth,
                    nodes,
                    time,
                    nps,
                    mv
                });
            } else if (message.startsWith("bestmove")) {
                this.engine.removeMessageListener(handler);
                callback({ type: "bestmove", mv: message.split(" ")[1] });
            }
        };
        this.engine.addMessageListener(handler);
        this.engine.postMessage(`position fen ${initPos} moves ${moves.join(" ")}`);
        this.engine.postMessage(`go movetime ${thinkTime}`);
    }

    stop() {
        this.engine.postMessage("quit");
    }
}

(async () => {
    const START_POS = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    const boardConfig = {
        pieceTheme: "pieces/{piece}.svg",
        draggable: true,
        orientation: "white",
        position: START_POS,
        onDragStart: () => false
    };
    const board = Chessboard("board", boardConfig);
    addEventListener("resize", () => board.resize());
    const boardElement = document.getElementById("board");
    const promotions = document.getElementById("promotions");
    const gameHistory = document.getElementById("game-history");
    const newGame = document.getElementById("new-game");
    const p1Eval = document.getElementById("p1-eval");
    const p2Eval = document.getElementById("p2-eval");
    const newGamePanel = document.getElementById("new-game-panel");
    const loadingBanner = document.getElementById("loading-banner");
    const modeButtons = [...document.getElementsByClassName("mode")];
    const thinkTimeElement = document.getElementById("think-time");
    let thinkTime = 3;
    thinkTimeElement.value = thinkTime;
    thinkTimeElement.onchange = () => {
        const value = Math.max(0, Math.min(99999, parseFloat("0" + thinkTimeElement.value, 10)));
        if (!isNaN(value)) {
            thinkTime = value;
        }
        thinkTimeElement.value = thinkTime;
    };

    const audioContext = new AudioContext();
    async function loadAudio(url) {
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        return await audioContext.decodeAudioData(buffer);
    }
    function playAudio(buffer) {
        const node = audioContext.createBufferSource();
        node.connect(audioContext.destination);
        node.buffer = buffer;
        node.start();
    }
    const moveSound = await loadAudio("./sounds/move.ogg")
    const captureSound = await loadAudio("./sounds/capture.ogg");

    while (true) {
        const players = {
            "w": engineMove,
            "b": engineMove
        };
        await new Promise(resolve => {
            newGamePanel.style.visibility = "visible";
            for (const modeButton of modeButtons) {
                const mode = modeButton.getAttribute("data-mode");
                modeButton.onclick = () => {
                    if (mode !== "auto") {
                        board.orientation(mode);
                        players[mode[0]] = playerMove;
                    } else {
                        board.orientation("white");
                    }
                    newGamePanel.style.visibility = "hidden";
                    resolve();
                };
            }
        });

        const game = new Chess(START_POS);
        function playerMove(color) {
            return new Promise(resolve => {
                boardConfig.onDragStart = (_, piece) => piece[0] === color;
                boardConfig.onDrop = (from, to) => {
                    const move = game
                        .moves({ square: from, verbose: true })
                        .find(m => m.to === to)
                    if (move === undefined) {
                        return "snapback";
                    }
                    if (move.promotion !== undefined) {
                        promotions.style.visibility = "visible";
                        for (const promotion of promotions.children) {
                            const piece = promotion.getAttribute("data-piece");
                            promotion.style.background = `url("pieces/${game.turn()}${piece}.svg")`;
                            promotion.onclick = () => {
                                resolve({ from, to, promotion: piece.toLowerCase() });
                            };
                        }
                    } else {
                        resolve({ from, to });
                    }
                };
            });
        }
        function engineMove(color) {
            return new Promise(res => {
                engine.newSearch(
                    Math.round(thinkTime * 1000),
                    START_POS,
                    game.history({ verbose: true }).map(m => m.from + m.to + (m.promotion || "")),
                    update => {
                        if (update.type === "bestmove") {
                            res(update.mv);
                            return;
                        }
                        const eval = board.orientation()[0] === color
                            ? p1Eval
                            : p2Eval;
                        eval.innerText = [
                            "Eval:   " + update.value,
                            "Depth:  " + update.depth,
                            "Nodes:  " + update.nodes,
                            "Time:   " + update.time.toFixed(2) + "s",
                            "NPS:    " + update.nps
                        ].join("\n");
                        const from = update.mv.slice(0, 2);
                        const to = update.mv.slice(2, 4);
                        for (const square of [...boardElement.getElementsByClassName("highlighted")]) {
                            square.classList.remove("highlighted");
                        }
                        for (const square of [from, to]) {
                            const squareElement = boardElement
                                .getElementsByClassName("square-" + square)[0];
                            squareElement.classList.add("highlighted");
                        }
                    }
                );
            });
        }

        boardConfig.onMoveEnd = null;
        board.position(game.fen());
        gameHistory.innerText = "";
        p1Eval.innerText = "";
        p2Eval.innerText = "";
        loadingBanner.style.visibility = "visible";
        newGame.disabled = true;
        const engine = new Engine(await Koivisto());
        await engine.newGame();
        loadingBanner.style.visibility = "hidden";
        newGame.disabled = false;
        gameLoop: while (true) {
            const event = await Promise.race([
                players[game.turn()](game.turn()).then(move => ({ event: "move", move })),
                new Promise(r => newGame.onclick = () => r({ event: "newGame" }))
            ]);
            boardConfig.onDragStart = () => false;
            boardConfig.onDrop = null;
            promotions.style.visibility = "hidden";
            for (const square of [...boardElement.getElementsByClassName("highlighted")]) {
                square.classList.remove("highlighted");
            }
            
            switch (event.event) {
                case "move":
                    const moveFlags = game.move(event.move, { sloppy: true }).flags;
                    const sound = moveFlags.includes("c") ? captureSound : moveSound;
                    boardConfig.onMoveEnd = () => playAudio(sound);
                    boardConfig.onSnapEnd = boardConfig.onMoveEnd;

                    board.position(game.fen());
                    gameHistory.innerText = game.pgn();
                    gameHistory.scrollTop = gameHistory.scrollHeight;
                    if (game.game_over()) {
                        await new Promise(r => newGame.onclick = r);
                        break gameLoop;
                    }
                    break;
                case "newGame":
                    break gameLoop;
            }
        }
        engine.stop();
    }
})();
