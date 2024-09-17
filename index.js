const { ApolloServer } = require("@apollo/server");
const { startStandaloneServer } = require("@apollo/server/standalone");
const { makeExecutableSchema } = require("@graphql-tools/schema");
const { WebSocketServer } = require("ws");
const { useServer } = require("graphql-ws/lib/use/ws");
const { PubSub } = require("graphql-subscriptions");
const connectDB = require("./db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Book = require("./models/Book");
const Author = require("./models/Author");
const User = require("./models/User");
const { GraphQLError } = require("graphql");

const JWT_SECRET = process.env.JWT_SECRET;
require("dotenv").config();

connectDB();

const pubsub = new PubSub();

const typeDefs = `
    type Author {
        name: String!
        id: ID!
        born: Int
        bookCount: Int
    }

    type Book {
        title: String!
        published: Int!
        author: Author!
        id: ID!
        genres: [String!]!
    }

    type User {
        username: String!
        favoriteGenre: String!
        id: ID!
    }

    type Token {
        value: String!
        favoriteGenre: String!
    }

    type Query {
        me: User
        bookCount: Int!
        authorCount: Int!
        allBooks(author: String, genre: String): [Book!]!
        allAuthors: [Author!]!
    }

    type Mutation {
        addBook(
            title: String!
            author: String!
            published: Int!
            genres: [String!]!
        ): Book

        editAuthor(name: String!, setBornTo: Int!): Author

        createUser(
            username: String!
            favoriteGenre: String!
            password: String!
        ): User

        login(
            username: String!
            password: String!
        ): Token
    }

    type Subscription {
        bookAdded: Book!
    }
`;

// Resolvers
const resolvers = {
    Query: {
        bookCount: async () => Book.countDocuments(),
        authorCount: async () => Author.countDocuments(),
        allBooks: async (root, args) => {
            let query = {};

            if (args.author) {
                const author = await Author.findOne({ name: args.author });
                if (author) {
                    query.author = author._id;
                }
            }
            if (args.genre) {
                query.genres = { $in: [args.genre] };
            }

            return Book.find(query).populate("author");
        },
        allAuthors: async () => Author.find({}),
        me: (root, args, context) => {
            return context.currentUser;
        },
    },
    Mutation: {
        addBook: async (root, args, context) => {
            if (!context.currentUser) {
                throw new GraphQLError("No autorizado", {
                    extensions: { code: "UNAUTHENTICATED" },
                });
            }

            let author = await Author.findOne({ name: args.author });

            if (!author) {
                author = new Author({ name: args.author });
                await author.save();
            }

            const newBook = new Book({
                title: args.title,
                published: args.published,
                author: author._id,
                genres: args.genres,
            });

            await newBook.save();
            const populatedBook = await newBook.populate("author");

            // Publish the new book
            pubsub.publish("BOOK_ADDED", { bookAdded: populatedBook });

            return populatedBook;
        },

        editAuthor: async (root, args, context) => {
            if (!context.currentUser) {
                throw new GraphQLError("No autorizado", {
                    extensions: { code: "UNAUTHENTICATED" },
                });
            }

            const author = await Author.findOne({ name: args.name });
            if (!author) {
                throw new GraphQLError("El autor no existe", {
                    extensions: { code: "NOT_FOUND" },
                });
            }

            author.born = args.setBornTo;
            await author.save();
            return author;
        },

        createUser: async (root, args) => {
            const { username, favoriteGenre } = args;

            const existingUser = await User.findOne({ username });
            if (existingUser) {
                throw new GraphQLError("El nombre de usuario ya está en uso", {
                    extensions: { code: "BAD_USER_INPUT" },
                });
            }

            const passwordHash = await bcrypt.hash("defaultpassword", 10);

            const newUser = new User({
                username,
                favoriteGenre,
                passwordHash,
            });

            try {
                await newUser.save();
                return newUser;
            } catch (error) {
                throw new GraphQLError("Error al crear el usuario: " + error.message, {
                    extensions: { code: "BAD_USER_INPUT" },
                });
            }
        },

        login: async (root, args) => {
            const { username, password } = args;
            const user = await User.findOne({ username });
            if (!user) {
                throw new GraphQLError("Usuario no encontrado", {
                    extensions: { code: "BAD_USER_INPUT" },
                });
            }

            const passwordValid = await bcrypt.compare(password, user.passwordHash);
            if (!passwordValid) {
                throw new GraphQLError("Contraseña incorrecta", {
                    extensions: { code: "BAD_USER_INPUT" },
                });
            }

            const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET);
            return { value: token, favoriteGenre: user.favoriteGenre };
        },
    },
    Subscription: {
        bookAdded: {
            subscribe: () => pubsub.asyncIterator(["BOOK_ADDED"]),
        },
    },
    Author: {
        bookCount: async (root) => Book.countDocuments({ author: root._id }),
    },
};

// Create the Schema
const schema = makeExecutableSchema({ typeDefs, resolvers });

// The Apollo server
const server = new ApolloServer({ schema });

// Inits HTTP & WebSocket
const httpServer = require("http").createServer();
const wsServer = new WebSocketServer({
    server: httpServer,
    path: "/graphql",
});

// Configure WebSocket with graphql-ws
useServer({ schema }, wsServer);

startStandaloneServer(server, {
    context: async ({ req }) => {
        const auth = req ? req.headers.authorization : null;
        if (auth && auth.toLowerCase().startsWith("bearer ")) {
            const token = auth.substring(7);
            try {
                const decodedToken = jwt.verify(token, JWT_SECRET);
                const currentUser = await User.findById(decodedToken.id);
                return { currentUser };
            } catch (err) {
                console.log("Token inválido");
            }
        }
        return null;
    },
    listen: { port: 4000 },
}).then(({ url }) => {
    console.log(`Server ready at ${url}`);
    httpServer.listen(4001, () => {
        console.log(`WebSocket server ready at ws://localhost:4001/graphql`);
    });
});
