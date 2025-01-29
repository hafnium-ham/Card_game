pub struct Game {
    players: Vec<Player>,
    deck: Deck,
    current_player: usize,
    direction: i8, // 1 for clockwise, -1 for counterclockwise
}

impl Game {
    pub fn new(player_names: Vec<&str>) -> Self {
        let players = player_names
            .into_iter()
            .map(|name| Player::new(name))
            .collect();
        let mut deck = Deck::new();
        deck.shuffle();
        Self {
            players,
            deck,
            current_player: 0,
            direction: 1,
        }
    }

    pub fn start(&mut self) {
        // Deal initial cards, set up the game state
    }

    pub fn next_turn(&mut self) {
        self.current_player = ((self.current_player as isize + self.direction as isize)
            % self.players.len() as isize)
            as usize;
    }
}
