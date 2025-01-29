use raylib::prelude::*;

/// Enum to track the current game state
enum GameState {
    StartScreen,
    Playing,
}

/// Struct to represent a card
struct Card {
    value: &'static str, // Card value (e.g., "10", "J", "Q")
    suit: &'static str,  // Card suit (♠, ♥, ♦, ♣)
    x: i32,              // X position on screen
    y: i32,              // Y position on screen
}

impl Card {
    /// Draws the card on the screen
    fn draw(&self, d: &mut RaylibDrawHandle) {
        let card_width = 60;
        let card_height = 90;

        // Determine color based on suit
        let text_color = match self.suit {
            "♥" | "♦" => Color::RED,
            _ => Color::BLACK,
        };

        // Draw card background
        d.draw_rectangle(self.x, self.y, card_width, card_height, Color::WHITE);
        d.draw_rectangle_lines(self.x, self.y, card_width, card_height, Color::BLACK);

        // Draw card value
        d.draw_text(self.value, self.x + 10, self.y + 10, 20, text_color);

        // Draw custom suit based on suit type
        match self.suit {
            "♠" => self.draw_spade(d),
            "♥" => self.draw_heart(d),
            "♦" => self.draw_diamond(d),
            "♣" => self.draw_club(d),
            _ => {}
        }
    }

    /// Draws a spade symbol (realistic)
    fn draw_spade(&self, d: &mut RaylibDrawHandle) {
        let x = self.x + 10;
        let y = self.y + 40;
        
        // Draw the spade shape using two triangles and a stem
        d.draw_triangle(Vector2::new(x as f32 + 10.0, y as f32),
                        Vector2::new(x as f32 + 30.0, y as f32 + 30.0),
                        Vector2::new(x as f32 + 50.0, y as f32),
                        Color::BLACK);

        d.draw_triangle(Vector2::new(x as f32 + 20.0, y as f32 + 10.0),
                        Vector2::new(x as f32 + 30.0, y as f32 + 30.0),
                        Vector2::new(x as f32 + 40.0, y as f32 + 10.0),
                        Color::BLACK);

        // Draw the spade stem
        d.draw_rectangle(x as i32 + 23, y as i32 + 30, 14, 20, Color::BLACK);
    }

    /// Draws a heart symbol (realistic)
    fn draw_heart(&self, d: &mut RaylibDrawHandle) {
        let x = self.x + 10;
        let y = self.y + 40;

        // Draw two circles for the top parts of the heart
        d.draw_circle(x + 10, y, 10.0, Color::RED);
        d.draw_circle(x + 30, y, 10.0, Color::RED);

        // Draw the triangle part at the bottom
        d.draw_triangle(Vector2::new(x as f32 + 20.0, y as f32 + 20.0),
                        Vector2::new(x as f32 + 30.0, y as f32 + 50.0),
                        Vector2::new(x as f32 + 40.0, y as f32 + 20.0),
                        Color::RED);
    }

    /// Draws a diamond symbol (realistic)
    fn draw_diamond(&self, d: &mut RaylibDrawHandle) {
        let x = self.x + 10;
        let y = self.y + 40;

        // Draw diamond shape as a rotated square
        d.draw_poly(Vector2::new(x as f32 + 20.0, y as f32 + 8.0), 4, 20.0, 0.0, Color::RED);
    }



    /// Draws a club symbol (realistic)
    fn draw_club(&self, d: &mut RaylibDrawHandle) {
        let x = self.x + 10;
        let y = self.y + 40;

        // Draw the club head as three stacked circles
        d.draw_circle(x + 10, y + 5, 10.0, Color::BLACK);
        d.draw_circle(x + 30, y + 5, 10.0, Color::BLACK);
        d.draw_circle(x + 20, y - 5, 10.0, Color::BLACK);

        // Draw the club stem
        d.draw_rectangle(x + 15, y + 7, 10, 20, Color::BLACK);
    }
}



/// Function to initialize and run the game window
pub fn run_game_window() {
    let (mut rl, thread) = raylib::init()
        .size(800, 600)
        .title("Card Game")
        .build();

    let mut game_state = GameState::StartScreen;

    // Example hand of cards
    let mut player_hand = vec![
        Card { value: "10", suit: "♠", x: 100, y: 400 },
        Card { value: "J", suit: "♥", x: 170, y: 400 },
        Card { value: "Q", suit: "♦", x: 240, y: 400 },
        Card { value: "K", suit: "♣", x: 310, y: 400 },
    ];

    while !rl.window_should_close() {
        let mouse_pos = rl.get_mouse_position();
        let mouse_clicked = rl.is_mouse_button_pressed(MouseButton::MOUSE_BUTTON_LEFT);

        let mut d = rl.begin_drawing(&thread);
        d.clear_background(Color::RAYWHITE);

        match game_state {
            GameState::StartScreen => {
                d.draw_text("Welcome to the Card Game!", 190, 150, 25, Color::DARKGRAY);

                let button_x = 300;
                let button_y = 300;
                let button_width = 200;
                let button_height = 50;

                let is_hovered = mouse_pos.x > button_x as f32
                    && mouse_pos.x < (button_x + button_width) as f32
                    && mouse_pos.y > button_y as f32
                    && mouse_pos.y < (button_y + button_height) as f32;

                let button_color = if is_hovered { Color::LIGHTGRAY } else { Color::GRAY };

                d.draw_rectangle(button_x, button_y, button_width, button_height, button_color);
                d.draw_text("Start Game", button_x + 40, button_y + 15, 20, Color::WHITE);

                if is_hovered && mouse_clicked {
                    game_state = GameState::Playing;
                }
            }
            GameState::Playing => {
                d.draw_text("Game in Progress...", 250, 50, 25, Color::DARKGRAY);

                // Render all cards in the player's hand
                for card in &player_hand {
                    card.draw(&mut d);
                }
            }
        }
    }
}
